import { z } from "zod";

import { parseCapacityKg } from "@/domain/vehicle";
import type { PrismaClient } from "@/generated/prisma/client";

import { recordAudit } from "./audit";

/**
 * Vehicles (NUD-146, D24): master data of the delivery fleet. A vehicle has a name, an optional
 * plate and a capacity in whole kg. Never hard-deleted (`active=false`); a tour that points at a
 * deactivated vehicle keeps it. Every write is audited in the same transaction. The callers
 * (`vehicle-actions.ts`) have checked the ADMIN role.
 */

type VehicleDb = Pick<PrismaClient, "vehicle" | "auditLog" | "$transaction">;

export const vehicleInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    plate: z
      .string()
      .trim()
      .max(20)
      .default("")
      .transform((v) => (v === "" ? null : v)),
    /** Capacity in whole kg: "1200" or a number. */
    capacityKg: z.union([z.string().max(8), z.number()]).transform((v, ctx) => {
      const parsed = parseCapacityKg(v);
      if (parsed === null) ctx.addIssue({ code: "custom", message: "invalid capacity" });
      return parsed ?? 0;
    }),
  })
  .strict();
export type VehicleInput = z.input<typeof vehicleInputSchema>;

export type VehicleSaveResult =
  { ok: true; id: string } | { ok: false; error: "invalid" | "not_found" | "name_taken" };

const idSchema = z.string().trim().min(1).max(64);

export type VehicleRow = {
  id: string;
  name: string;
  plate: string | null;
  capacityKg: number;
  active: boolean;
};

const select = { id: true, name: true, plate: true, capacityKg: true, active: true } as const;
const ORDER = [{ active: "desc" }, { name: "asc" }, { id: "asc" }] as const;

/** All vehicles for the admin list: active first, then by name. */
export async function listVehicles(db: Pick<PrismaClient, "vehicle">): Promise<VehicleRow[]> {
  return db.vehicle.findMany({ select, orderBy: [...ORDER] });
}

async function nameTaken(
  db: Pick<PrismaClient, "vehicle">,
  name: string,
  exceptId?: string,
): Promise<boolean> {
  const hit = await db.vehicle.findFirst({
    where: {
      name: { equals: name, mode: "insensitive" },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });
  return hit !== null;
}

export async function createVehicleWith(
  db: VehicleDb,
  actorId: string,
  rawInput: unknown,
): Promise<VehicleSaveResult> {
  const parsed = vehicleInputSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;
  if (await nameTaken(db, v.name)) return { ok: false, error: "name_taken" };
  return db.$transaction(async (tx) => {
    const row = await tx.vehicle.create({
      data: { name: v.name, plate: v.plate, capacityKg: v.capacityKg },
      select: { id: true },
    });
    await recordAudit(tx, {
      actorId,
      entity: "Vehicle",
      entityId: row.id,
      action: "vehicle.create",
      diff: { name: v.name, plate: v.plate, capacityKg: v.capacityKg },
    });
    return { ok: true as const, id: row.id };
  });
}

export async function updateVehicleWith(
  db: VehicleDb,
  actorId: string,
  rawId: unknown,
  rawInput: unknown,
): Promise<VehicleSaveResult> {
  const id = idSchema.safeParse(rawId);
  const parsed = vehicleInputSchema.safeParse(rawInput);
  if (!id.success || !parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;
  const stored = await db.vehicle.findUnique({ where: { id: id.data }, select });
  if (!stored) return { ok: false, error: "not_found" };
  if (await nameTaken(db, v.name, stored.id)) return { ok: false, error: "name_taken" };
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  if (stored.name !== v.name) diff.name = { from: stored.name, to: v.name };
  if (stored.plate !== v.plate) diff.plate = { from: stored.plate, to: v.plate };
  if (stored.capacityKg !== v.capacityKg) {
    diff.capacityKg = { from: stored.capacityKg, to: v.capacityKg };
  }
  if (Object.keys(diff).length === 0) return { ok: true, id: stored.id };
  return db.$transaction(async (tx) => {
    await tx.vehicle.update({
      where: { id: stored.id },
      data: { name: v.name, plate: v.plate, capacityKg: v.capacityKg },
    });
    await recordAudit(tx, {
      actorId,
      entity: "Vehicle",
      entityId: stored.id,
      action: "vehicle.update",
      diff,
    });
    return { ok: true as const, id: stored.id };
  });
}

/** Deactivate / reactivate (soft delete). Tours keep pointing at the vehicle. */
export async function setVehicleActiveWith(
  db: VehicleDb,
  actorId: string,
  rawId: unknown,
  rawActive: unknown,
): Promise<{ ok: true } | { ok: false; error: "invalid" | "not_found" }> {
  const id = idSchema.safeParse(rawId);
  const active = z.boolean().safeParse(rawActive);
  if (!id.success || !active.success) return { ok: false, error: "invalid" };
  return db.$transaction(async (tx) => {
    const stored = await tx.vehicle.findUnique({
      where: { id: id.data },
      select: { id: true, active: true },
    });
    if (!stored) return { ok: false as const, error: "not_found" as const };
    if (stored.active !== active.data) {
      await tx.vehicle.update({ where: { id: stored.id }, data: { active: active.data } });
      await recordAudit(tx, {
        actorId,
        entity: "Vehicle",
        entityId: stored.id,
        action: active.data ? "vehicle.activate" : "vehicle.deactivate",
        diff: { active: { from: stored.active, to: active.data } },
      });
    }
    return { ok: true as const };
  });
}
