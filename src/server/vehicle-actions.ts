"use server";

import { requireRole } from "./auth/guards";
import { getDb } from "./db";
import {
  createVehicleWith,
  setVehicleActiveWith,
  updateVehicleWith,
  type VehicleSaveResult,
} from "./vehicles";

/** Admin-only server actions for the vehicle master data (NUD-146; soft delete only, audited). */

export async function createVehicleAction(input: unknown): Promise<VehicleSaveResult> {
  const actor = await requireRole("ADMIN");
  return createVehicleWith(getDb(), actor.id, input);
}

export async function updateVehicleAction(id: unknown, input: unknown): Promise<VehicleSaveResult> {
  const actor = await requireRole("ADMIN");
  return updateVehicleWith(getDb(), actor.id, id, input);
}

export async function setVehicleActiveAction(id: unknown, active: unknown) {
  const actor = await requireRole("ADMIN");
  return setVehicleActiveWith(getDb(), actor.id, id, active);
}
