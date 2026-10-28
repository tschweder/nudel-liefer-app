import { z } from "zod";

import { ABBREVIATION_MAX, normalizeAbbreviation } from "@/domain/customer-abbreviation";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";

import { recordAudit } from "./audit";
import type { Actor } from "./auth/guards";

/**
 * Customer Abkürzung (NUD-164, D27): the legacy internal code of the old system. Same logic as the
 * key number (`customer-key.ts`): the office edits it on the customer form, drivers set, correct or
 * clear it at a stop (also from the offline queue, `POST /api/driver/sync`). The change and its
 * audit entry (`customer.abbreviation`, before/after) share one transaction, an unchanged value
 * writes nothing, there is no approval step. Free text, optional, NOT unique. Temporary.
 */

type AbbreviationDb = Pick<PrismaClient, "$transaction" | "customer" | "auditLog">;

export type AbbreviationVia = "office" | "driver" | "sync";

export const abbreviationSchema = z.string().trim().max(ABBREVIATION_MAX);

const idSchema = z.string().trim().min(1).max(64);

export type SetAbbreviationResult =
  | { ok: true; changed: boolean; abbreviation: string | null }
  | { ok: false; error: "invalid" | "not_found" };

type Tx = Prisma.TransactionClient;

export type AbbreviationChange = {
  actorId: string;
  customerId: string;
  abbreviation: string | null;
  via: AbbreviationVia;
  /** Moment of the driver's tap for entries from the offline queue. */
  clientCreatedAt?: Date;
  now: Date;
};

/** The write and its audit entry, inside the caller's transaction. */
async function writeAbbreviation(
  tx: Tx,
  change: AbbreviationChange,
): Promise<SetAbbreviationResult> {
  // Row lock: two quick edits of the same customer are applied one after the other.
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Customer" WHERE "id" = ${change.customerId} FOR UPDATE`;
  if (rows.length === 0) return { ok: false, error: "not_found" };
  const stored = await tx.customer.findUniqueOrThrow({
    where: { id: change.customerId },
    select: { abbreviation: true },
  });
  if (stored.abbreviation === change.abbreviation) {
    return { ok: true, changed: false, abbreviation: change.abbreviation };
  }
  await tx.customer.update({
    where: { id: change.customerId },
    data: {
      abbreviation: change.abbreviation,
      abbreviationUpdatedById: change.actorId,
      abbreviationUpdatedAt: change.now,
    },
    select: { id: true },
  });
  await recordAudit(tx, {
    actorId: change.actorId,
    entity: "Customer",
    entityId: change.customerId,
    action: "customer.abbreviation",
    diff: {
      abbreviation: { from: stored.abbreviation, to: change.abbreviation },
      via: change.via,
      ...(change.clientCreatedAt ? { clientCreatedAt: change.clientCreatedAt.toISOString() } : {}),
    },
  });
  return { ok: true, changed: true, abbreviation: change.abbreviation };
}

/** Replaces the Abkürzung of a customer (office form). Never throws for business rejections. */
export async function setCustomerAbbreviation(
  db: AbbreviationDb,
  input: {
    actorId: string;
    customerId: unknown;
    abbreviation?: string | null;
    via: AbbreviationVia;
    now?: Date;
  },
): Promise<SetAbbreviationResult> {
  const customerId = idSchema.safeParse(input.customerId);
  const abbreviation = normalizeAbbreviation(input.abbreviation);
  if (!customerId.success || abbreviation === undefined) return { ok: false, error: "invalid" };
  return db.$transaction((tx) =>
    writeAbbreviation(tx, {
      actorId: input.actorId,
      customerId: customerId.data,
      abbreviation,
      via: input.via,
      now: input.now ?? new Date(),
    }),
  );
}

// ---------------------------------------------------------------------------------------------
// Driver (offline queue)
// ---------------------------------------------------------------------------------------------

const abbreviationEntrySchema = z.strictObject({
  type: z.literal("abbreviation"),
  clientMutationId: z.uuid(),
  stopId: z.string().min(1).max(64),
  /** Absent or blank clears the Abkürzung. */
  abbreviation: abbreviationSchema.optional(),
});

export type DriverAbbreviationError = "invalid" | "forbidden" | "not_found" | "mutation_conflict";
export type DriverAbbreviationResult =
  { ok: true; replayed: boolean } | { ok: false; error: DriverAbbreviationError };

type ActingDriver = Pick<Actor, "id" | "role">;
type DriverAbbreviationDb = Pick<PrismaClient, "$transaction">;

/**
 * One queued Abkürzung entry of a driver (type `abbreviation` of the sync batch). The stop names the
 * customer: it must belong to a tour assigned to the acting driver (`not_found` otherwise, the same
 * answer for foreign and unknown stops), in any tour state, so an entry that syncs after the tour
 * ended still lands. Idempotent by `clientMutationId` (recorded in `StopMutation`, kind
 * `ABBREVIATION`): a replay changes nothing.
 */
export async function applyDriverAbbreviation(
  db: DriverAbbreviationDb,
  actor: ActingDriver,
  rawEntry: unknown,
  now: Date = new Date(),
  options: { clientCreatedAt?: Date } = {},
): Promise<DriverAbbreviationResult> {
  const parsed = abbreviationEntrySchema.safeParse(rawEntry);
  if (!parsed.success) return { ok: false, error: "invalid" };
  if (actor.role !== "DRIVER") return { ok: false, error: "forbidden" };
  const entry = parsed.data;

  const abbreviation = normalizeAbbreviation(entry.abbreviation);
  if (abbreviation === undefined) return { ok: false, error: "invalid" };

  try {
    return await db.$transaction(async (tx): Promise<DriverAbbreviationResult> => {
      const recorded = await tx.stopMutation.findUnique({ where: { id: entry.clientMutationId } });
      if (recorded) {
        return recorded.kind === "ABBREVIATION" &&
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
      const written = await writeAbbreviation(tx, {
        actorId: actor.id,
        customerId: stop.customerId,
        abbreviation,
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
          kind: "ABBREVIATION",
          result: { ok: true, kind: "ABBREVIATION", changed: written.changed },
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

export type AbbreviationHistoryEntry = {
  id: string;
  /** ISO instant. */
  at: string;
  actor: { name: string; role: "ADMIN" | "DRIVER" } | null;
  from: string | null;
  to: string | null;
  via: AbbreviationVia;
};

const abbreviationDiffSchema = z.object({
  abbreviation: z.object({
    from: z.string().max(ABBREVIATION_MAX).nullable(),
    to: z.string().max(ABBREVIATION_MAX).nullable(),
  }),
  via: z.enum(["office", "driver", "sync"]),
});

/** Abkürzung changes of one customer, newest first (so a corrected value can still be read). */
export async function getCustomerAbbreviationHistory(
  db: Pick<PrismaClient, "auditLog" | "user">,
  rawCustomerId: unknown,
  limit = 20,
): Promise<AbbreviationHistoryEntry[]> {
  const id = idSchema.safeParse(rawCustomerId);
  if (!id.success) return [];
  const rows = await db.auditLog.findMany({
    where: { entity: "Customer", entityId: id.data, action: "customer.abbreviation" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
  });
  const users = await db.user.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.actorId))] } },
    select: { id: true, displayName: true, role: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));
  return rows.flatMap((row) => {
    const diff = abbreviationDiffSchema.safeParse(row.diff);
    if (!diff.success) return [];
    const user = byId.get(row.actorId);
    return [
      {
        id: row.id,
        at: row.createdAt.toISOString(),
        actor: user ? { name: user.displayName, role: user.role } : null,
        from: diff.data.abbreviation.from,
        to: diff.data.abbreviation.to,
        via: diff.data.via,
      },
    ];
  });
}
