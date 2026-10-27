import { z } from "zod";

import { type CustomerKey, KEY_NUMBER_MAX, normalizeKey, sameKey } from "@/domain/customer-key";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";

import { recordAudit } from "./audit";
import type { Actor } from "./auth/guards";

/**
 * Customer key (NUD-142, D27): whether the factory holds a key to the shop and its number. The
 * office edits it on the customer form, drivers set or correct it at a stop (also from the offline
 * queue, `POST /api/driver/sync`). Both go through `setCustomerKey`: the change and its audit entry
 * (`customer.key`, before/after) share one transaction, and an unchanged value writes nothing.
 * There is no approval step and no conflict rule: the driver's field knowledge wins (D27).
 */

type KeyDb = Pick<PrismaClient, "$transaction" | "customer" | "auditLog">;

export type KeyVia = "office" | "driver" | "sync";

export const keyNumberSchema = z.string().trim().max(KEY_NUMBER_MAX);

const idSchema = z.string().trim().min(1).max(64);

export type SetKeyResult =
  { ok: true; changed: boolean; key: CustomerKey } | { ok: false; error: "invalid" | "not_found" };

type Tx = Prisma.TransactionClient;

export type KeyChange = {
  actorId: string;
  customerId: string;
  key: CustomerKey;
  via: KeyVia;
  /** Moment of the driver's tap for entries from the offline queue. */
  clientCreatedAt?: Date;
  now: Date;
};

/** The write and its audit entry, inside the caller's transaction. */
async function writeKey(tx: Tx, change: KeyChange): Promise<SetKeyResult> {
  // Row lock: two quick edits of the same customer are applied one after the other.
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Customer" WHERE "id" = ${change.customerId} FOR UPDATE`;
  if (rows.length === 0) return { ok: false, error: "not_found" };
  const stored = await tx.customer.findUniqueOrThrow({
    where: { id: change.customerId },
    select: { hasKey: true, keyNumber: true },
  });
  const before: CustomerKey = { hasKey: stored.hasKey, keyNumber: stored.keyNumber };
  if (sameKey(before, change.key)) return { ok: true, changed: false, key: change.key };
  await tx.customer.update({
    where: { id: change.customerId },
    data: {
      hasKey: change.key.hasKey,
      keyNumber: change.key.keyNumber,
      keyUpdatedById: change.actorId,
      keyUpdatedAt: change.now,
    },
    select: { id: true },
  });
  await recordAudit(tx, {
    actorId: change.actorId,
    entity: "Customer",
    entityId: change.customerId,
    action: "customer.key",
    diff: {
      hasKey: { from: before.hasKey, to: change.key.hasKey },
      keyNumber: { from: before.keyNumber, to: change.key.keyNumber },
      via: change.via,
      ...(change.clientCreatedAt ? { clientCreatedAt: change.clientCreatedAt.toISOString() } : {}),
    },
  });
  return { ok: true, changed: true, key: change.key };
}

/** Replaces the key of a customer (office form). Never throws for business rejections. */
export async function setCustomerKey(
  db: KeyDb,
  input: {
    actorId: string;
    customerId: unknown;
    hasKey: boolean | null;
    keyNumber?: string | null;
    via: KeyVia;
    now?: Date;
  },
): Promise<SetKeyResult> {
  const customerId = idSchema.safeParse(input.customerId);
  const key = normalizeKey({ hasKey: input.hasKey, keyNumber: input.keyNumber });
  if (!customerId.success || !key) return { ok: false, error: "invalid" };
  return db.$transaction((tx) =>
    writeKey(tx, {
      actorId: input.actorId,
      customerId: customerId.data,
      key,
      via: input.via,
      now: input.now ?? new Date(),
    }),
  );
}

// ---------------------------------------------------------------------------------------------
// Driver (offline queue)
// ---------------------------------------------------------------------------------------------

const keyEntrySchema = z.strictObject({
  type: z.literal("key"),
  clientMutationId: z.uuid(),
  stopId: z.string().min(1).max(64),
  hasKey: z.boolean(),
  keyNumber: keyNumberSchema.optional(),
});

export type DriverKeyError = "invalid" | "forbidden" | "not_found" | "mutation_conflict";
export type DriverKeyResult =
  { ok: true; replayed: boolean } | { ok: false; error: DriverKeyError };

type ActingDriver = Pick<Actor, "id" | "role">;
type DriverKeyDb = Pick<PrismaClient, "$transaction">;

/**
 * One queued key entry of a driver (type `key` of the sync batch). The stop names the customer: it
 * must belong to a tour assigned to the acting driver (`not_found` otherwise, the same answer for
 * foreign and unknown stops), in any tour state, so an entry that syncs after the tour ended still
 * lands. Idempotent by `clientMutationId` (recorded in `StopMutation`, kind `KEY`): a replay
 * changes nothing. A driver can only say "yes + number" or "no": unknown is the office's reset.
 */
export async function applyDriverKey(
  db: DriverKeyDb,
  actor: ActingDriver,
  rawEntry: unknown,
  now: Date = new Date(),
  options: { clientCreatedAt?: Date } = {},
): Promise<DriverKeyResult> {
  const parsed = keyEntrySchema.safeParse(rawEntry);
  if (!parsed.success) return { ok: false, error: "invalid" };
  if (actor.role !== "DRIVER") return { ok: false, error: "forbidden" };
  const entry = parsed.data;

  const key = normalizeKey({ hasKey: entry.hasKey, keyNumber: entry.keyNumber });
  if (!key) return { ok: false, error: "invalid" };

  try {
    return await db.$transaction(async (tx): Promise<DriverKeyResult> => {
      const recorded = await tx.stopMutation.findUnique({ where: { id: entry.clientMutationId } });
      if (recorded) {
        return recorded.kind === "KEY" &&
          recorded.stopId === entry.stopId &&
          recorded.driverId === actor.id
          ? { ok: true, replayed: true }
          : { ok: false, error: "mutation_conflict" };
      }
      const stop = await tx.stop.findUnique({
        where: { id: entry.stopId },
        select: { customerId: true, tour: { select: { driverId: true } } },
      });
      if (!stop || stop.tour.driverId !== actor.id) return { ok: false, error: "not_found" };
      const written = await writeKey(tx, {
        actorId: actor.id,
        customerId: stop.customerId,
        key,
        via: options.clientCreatedAt ? "sync" : "driver",
        clientCreatedAt: options.clientCreatedAt,
        now,
      });
      if (!written.ok) return { ok: false, error: "not_found" };
      await tx.stopMutation.create({
        data: {
          id: entry.clientMutationId,
          stopId: entry.stopId,
          driverId: actor.id,
          kind: "KEY",
          result: { ok: true, kind: "KEY", changed: written.changed },
        },
      });
      return { ok: true, replayed: false };
    });
  } catch (error) {
    // The same id arrived twice at once and the other request committed first: it is applied.
    if ((error as { code?: unknown }).code === "P2002") return { ok: true, replayed: true };
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------
// History (office)
// ---------------------------------------------------------------------------------------------

export type KeyHistoryEntry = {
  id: string;
  /** ISO instant. */
  at: string;
  actor: { name: string; role: "ADMIN" | "DRIVER" } | null;
  from: CustomerKey;
  to: CustomerKey;
  via: KeyVia;
};

const changeSchema = z.object({
  from: z.union([z.boolean(), z.string().max(KEY_NUMBER_MAX)]).nullable(),
  to: z.union([z.boolean(), z.string().max(KEY_NUMBER_MAX)]).nullable(),
});
const keyDiffSchema = z.object({
  hasKey: changeSchema,
  keyNumber: changeSchema,
  via: z.enum(["office", "driver", "sync"]),
});

const asKey = (hasKey: unknown, keyNumber: unknown): CustomerKey => ({
  hasKey: typeof hasKey === "boolean" ? hasKey : null,
  keyNumber: typeof keyNumber === "string" ? keyNumber : null,
});

/** Key changes of one customer, newest first (so a corrected number can still be read). */
export async function getCustomerKeyHistory(
  db: Pick<PrismaClient, "auditLog" | "user">,
  rawCustomerId: unknown,
  limit = 20,
): Promise<KeyHistoryEntry[]> {
  const id = idSchema.safeParse(rawCustomerId);
  if (!id.success) return [];
  const rows = await db.auditLog.findMany({
    where: { entity: "Customer", entityId: id.data, action: "customer.key" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
  });
  const users = await db.user.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.actorId))] } },
    select: { id: true, displayName: true, role: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));
  return rows.flatMap((row) => {
    const diff = keyDiffSchema.safeParse(row.diff);
    if (!diff.success) return [];
    const user = byId.get(row.actorId);
    return [
      {
        id: row.id,
        at: row.createdAt.toISOString(),
        actor: user ? { name: user.displayName, role: user.role } : null,
        from: asKey(diff.data.hasKey.from, diff.data.keyNumber.from),
        to: asKey(diff.data.hasKey.to, diff.data.keyNumber.to),
        via: diff.data.via,
      },
    ];
  });
}
