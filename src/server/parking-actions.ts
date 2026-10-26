"use server";

import { requireRole } from "./auth/guards";
import { getDb } from "./db";
import {
  createParkingSpot,
  deactivateParkingSpot,
  reorderParkingSpots,
  updateParkingSpot,
} from "./parking-spots";

/**
 * Admin-only server actions for a customer's Parkplätze (NUD-125). The role is checked against the
 * database before the input is read; every write is audited in the service transaction and
 * "remove" is a soft delete (`active=false`). Drivers get their own action in NUD-126.
 */

export async function createParkingSpotAction(input: unknown) {
  const actor = await requireRole("ADMIN");
  return createParkingSpot(getDb(), actor.id, input);
}

export async function updateParkingSpotAction(input: unknown) {
  const actor = await requireRole("ADMIN");
  return updateParkingSpot(getDb(), actor.id, input);
}

export async function reorderParkingSpotsAction(input: unknown) {
  const actor = await requireRole("ADMIN");
  return reorderParkingSpots(getDb(), actor.id, input);
}

export async function deactivateParkingSpotAction(input: unknown) {
  const actor = await requireRole("ADMIN");
  return deactivateParkingSpot(getDb(), actor.id, input);
}
