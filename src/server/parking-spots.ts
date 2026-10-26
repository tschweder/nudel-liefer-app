import { z } from "zod";

import {
  activeParkingSpots,
  PARKING_LABEL_MAX,
  PARKING_MAX_ACTIVE,
  PARKING_NOTE_MAX,
} from "@/domain/parking";
import type { PrismaClient } from "@/generated/prisma/client";
import { roundCoord } from "@/lib/coords";

import { recordAudit } from "./audit";

type ParkingDb = Pick<PrismaClient, "$transaction" | "customer" | "parkingSpot" | "auditLog">;

const idSchema = z.string().trim().min(1).max(64);
/** Blank text means "none". */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullish()
    .transform((v) => v ?? null);

const fields = {
  label: optionalText(PARKING_LABEL_MAX),
  note: optionalText(PARKING_NOTE_MAX),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
};

export const createParkingSpotSchema = z.object({ customerId: idSchema, ...fields });
export const updateParkingSpotSchema = z.object({ id: idSchema, ...fields });
export const reorderParkingSpotsSchema = z.object({
  customerId: idSchema,
  ids: z.array(idSchema).min(1).max(PARKING_MAX_ACTIVE),
});
export const deactivateParkingSpotSchema = z.object({ id: idSchema });

export type ParkingSpotView = {
  id: string;
  label: string | null;
  note: string | null;
  lat: number;
  lng: number;
  sortOrder: number;
  /** The first active spot: the routing and navigation point. */
  isDefault: boolean;
};

export type ParkingResult =
  | { ok: true; spotId?: string }
  | { ok: false; error: "invalid" | "not_found" | "limit" | "conflict" };

/** Active spots of one customer in display order; the first one is flagged as default. */
export async function listParkingSpots(
  db: Pick<PrismaClient, "parkingSpot">,
  rawCustomerId: unknown,
): Promise<ParkingSpotView[]> {
  const id = idSchema.safeParse(rawCustomerId);
  if (!id.success) return [];
  const rows = await db.parkingSpot.findMany({
    where: { customerId: id.data, active: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map((r, index) => ({
    id: r.id,
    label: r.label,
    note: r.note,
    lat: r.lat,
    lng: r.lng,
    sortOrder: r.sortOrder,
    isDefault: index === 0,
  }));
}

async function lockCustomer(tx: Pick<PrismaClient, "$queryRaw">, customerId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Customer" WHERE "id" = ${customerId} FOR UPDATE`;
  return rows.length > 0;
}

/** Adds a spot at the end of the list (it becomes the default when the list was empty). */
export async function createParkingSpot(
  db: ParkingDb,
  actorId: string,
  raw: unknown,
): Promise<ParkingResult> {
  const parsed = createParkingSpotSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const input = parsed.data;
  return db.$transaction(async (tx): Promise<ParkingResult> => {
    if (!(await lockCustomer(tx, input.customerId))) return { ok: false, error: "not_found" };
    const existing = await tx.parkingSpot.findMany({
      where: { customerId: input.customerId },
      select: { sortOrder: true, active: true },
    });
    if (existing.filter((s) => s.active).length >= PARKING_MAX_ACTIVE) {
      return { ok: false, error: "limit" };
    }
    const sortOrder = existing.reduce((max, s) => Math.max(max, s.sortOrder), -1) + 1;
    const spot = await tx.parkingSpot.create({
      data: {
        customerId: input.customerId,
        label: input.label,
        note: input.note,
        lat: roundCoord(input.lat),
        lng: roundCoord(input.lng),
        sortOrder,
        createdById: actorId,
      },
      select: { id: true },
    });
    await recordAudit(tx, {
      actorId,
      entity: "Customer",
      entityId: input.customerId,
      action: "parking.create",
      diff: {
        spotId: spot.id,
        lat: roundCoord(input.lat),
        lng: roundCoord(input.lng),
        isDefault: !existing.some((s) => s.active),
      },
    });
    return { ok: true, spotId: spot.id };
  });
}

/** Edits label, note and position of an active spot. Free text is not copied into the audit log. */
export async function updateParkingSpot(
  db: ParkingDb,
  actorId: string,
  raw: unknown,
): Promise<ParkingResult> {
  const parsed = updateParkingSpotSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const input = parsed.data;
  return db.$transaction(async (tx): Promise<ParkingResult> => {
    const spot = await tx.parkingSpot.findUnique({ where: { id: input.id } });
    if (!spot || !spot.active) return { ok: false, error: "not_found" };
    if (!(await lockCustomer(tx, spot.customerId))) return { ok: false, error: "not_found" };
    const lat = roundCoord(input.lat);
    const lng = roundCoord(input.lng);
    const changed = [
      ...(spot.label !== input.label ? ["label"] : []),
      ...(spot.note !== input.note ? ["note"] : []),
      ...(spot.lat !== lat || spot.lng !== lng ? ["coordinates"] : []),
    ];
    if (changed.length === 0) return { ok: true, spotId: spot.id };
    await tx.parkingSpot.update({
      where: { id: spot.id },
      data: { label: input.label, note: input.note, lat, lng },
      select: { id: true },
    });
    await recordAudit(tx, {
      actorId,
      entity: "Customer",
      entityId: spot.customerId,
      action: "parking.update",
      diff: {
        spotId: spot.id,
        fields: changed,
        ...(changed.includes("coordinates")
          ? { from: { lat: spot.lat, lng: spot.lng }, to: { lat, lng } }
          : {}),
      },
    });
    return { ok: true, spotId: spot.id };
  });
}

/**
 * Stores a new order of the customer's active spots; `ids` must name exactly the active spots (a
 * list changed in the meantime is a `conflict`, the client reloads). The first id is the default.
 */
export async function reorderParkingSpots(
  db: ParkingDb,
  actorId: string,
  raw: unknown,
): Promise<ParkingResult> {
  const parsed = reorderParkingSpotsSchema.safeParse(raw);
  if (!parsed.success || new Set(parsed.data.ids).size !== parsed.data.ids.length) {
    return { ok: false, error: "invalid" };
  }
  const { customerId, ids } = parsed.data;
  return db.$transaction(async (tx): Promise<ParkingResult> => {
    if (!(await lockCustomer(tx, customerId))) return { ok: false, error: "not_found" };
    const active = activeParkingSpots(
      await tx.parkingSpot.findMany({ where: { customerId, active: true } }),
    );
    const current = active.map((s) => s.id);
    if (current.length !== ids.length || !ids.every((id) => current.includes(id))) {
      return { ok: false, error: "conflict" };
    }
    if (current.every((id, i) => id === ids[i])) return { ok: true };
    for (const [index, id] of ids.entries()) {
      await tx.parkingSpot.update({
        where: { id },
        data: { sortOrder: index },
        select: { id: true },
      });
    }
    await recordAudit(tx, {
      actorId,
      entity: "Customer",
      entityId: customerId,
      action: "parking.reorder",
      diff: { from: current, to: ids, defaultId: ids[0] },
    });
    return { ok: true };
  });
}

/** Soft delete: the spot stays in the database with `active=false` and leaves every list. */
export async function deactivateParkingSpot(
  db: ParkingDb,
  actorId: string,
  raw: unknown,
): Promise<ParkingResult> {
  const parsed = deactivateParkingSpotSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  return db.$transaction(async (tx): Promise<ParkingResult> => {
    const spot = await tx.parkingSpot.findUnique({ where: { id: parsed.data.id } });
    if (!spot || !spot.active) return { ok: false, error: "not_found" };
    if (!(await lockCustomer(tx, spot.customerId))) return { ok: false, error: "not_found" };
    const active = activeParkingSpots(
      await tx.parkingSpot.findMany({ where: { customerId: spot.customerId, active: true } }),
    );
    await tx.parkingSpot.update({
      where: { id: spot.id },
      data: { active: false },
      select: { id: true },
    });
    await recordAudit(tx, {
      actorId,
      entity: "Customer",
      entityId: spot.customerId,
      action: "parking.deactivate",
      diff: { spotId: spot.id, wasDefault: active[0]?.id === spot.id },
    });
    return { ok: true, spotId: spot.id };
  });
}
