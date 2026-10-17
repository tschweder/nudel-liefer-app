"use server";

import { z } from "zod";

import { requireRole } from "./auth/guards";
import { getDb } from "./db";
import { getRoutingProvider } from "./routing";
import { getSettings } from "./settings";
import { generateTour, type GenerateTourResult } from "./tour-builder";
import {
  assignDriverWith,
  type PlanResult,
  releaseTourWith,
  reorderStopsWith,
  setTourLockedWith,
} from "./tour-planning";

const generateTourInputSchema = z.object({ date: z.string().trim().min(1).max(10) }).strict();

/**
 * Admin-only: builds or rebuilds the tour of one delivery day (`YYYY-MM-DD`). The planning page (NUD-042)
 * shows `error` / `warnings` of the result with messages (`depot_not_set` ->
 * `admin.settings.errors.depotNotSet`).
 */
export async function generateTourAction(input: unknown): Promise<GenerateTourResult> {
  await requireRole("ADMIN");
  const parsed = generateTourInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_date", warnings: [] };
  return generateTour(parsed.data.date);
}

/**
 * Admin-only: manual reorder of an unreleased tour. `{tourId, orderedStopIds}`; legs, ETAs and
 * geometry are recomputed with `route()`, the order is not optimized.
 */
export async function reorderStopsAction(
  input: unknown,
): Promise<PlanResult<{ changed: boolean; approximate: boolean }>> {
  await requireRole("ADMIN");
  return reorderStopsWith(
    { db: getDb(), provider: getRoutingProvider(), loadSettings: getSettings },
    input,
  );
}

/** Admin-only: lock / unlock an unreleased tour. `{tourId, locked}`. */
export async function setTourLockedAction(input: unknown): Promise<PlanResult> {
  await requireRole("ADMIN");
  return setTourLockedWith(getDb(), input);
}

/** Admin-only: assign an active driver (`driverId: null` clears it). `{tourId, driverId}`. */
export async function assignDriverAction(input: unknown): Promise<PlanResult> {
  await requireRole("ADMIN");
  return assignDriverWith(getDb(), input);
}

/** Admin-only: release the tour to its driver. `{tourId, version}` (version from the page). */
export async function releaseTourAction(
  input: unknown,
): Promise<PlanResult<{ releasedAt: string; stopCount: number }>> {
  await requireRole("ADMIN");
  return releaseTourWith(getDb(), input);
}
