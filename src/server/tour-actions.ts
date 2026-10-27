"use server";

import { z } from "zod";

import { requireRole } from "./auth/guards";
import { getDb } from "./db";
import { getRoutingProvider } from "./routing";
import { getSettings, requireDepotConfigured } from "./settings";
import { generateFollowUpTour, generateTour, type GenerateTourResult } from "./tour-builder";
import {
  type CreateEmptyTourResult,
  createEmptyTourWith,
  type EditTourOk,
  editTourWith,
} from "./tour-edit";
import {
  assignDriverWith,
  type PlanResult,
  releaseTourWith,
  reorderStopsWith,
  setTourLockedWith,
} from "./tour-planning";
import { type ReReleaseOk, reReleaseTourWith } from "./tour-rerelease";

const generateTourInputSchema = z.object({ date: z.string().trim().min(1).max(10) }).strict();

/**
 * Admin-only: builds or rebuilds the tour of one delivery day (`YYYY-MM-DD`). The planning page (NUD-042)
 * shows `error` / `warnings` of the result with messages (`depot_not_set` ->
 * `admin.settings.errors.depotNotSet`).
 */
export async function generateTourAction(input: unknown): Promise<GenerateTourResult> {
  const actor = await requireRole("ADMIN");
  const parsed = generateTourInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_date", warnings: [] };
  return generateTour(actor.id, parsed.data.date);
}

/**
 * Admin-only (NUD-099): creates a follow-up tour for the confirmed orders of a day (`YYYY-MM-DD`)
 * that are on no stop, after every tour of that day is COMPLETED. The completed tours stay as they
 * are; the new tour is unreleased (OPTIMIZED) and is planned and released like any other.
 */
export async function createFollowUpTourAction(input: unknown): Promise<GenerateTourResult> {
  const actor = await requireRole("ADMIN");
  const parsed = generateTourInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_date", warnings: [] };
  return generateFollowUpTour(actor.id, parsed.data.date);
}

/**
 * Admin-only: manual reorder of an unreleased tour. `{tourId, orderedStopIds}`; legs, ETAs and
 * geometry are recomputed with `route()`, the order is not optimized.
 */
export async function reorderStopsAction(
  input: unknown,
): Promise<PlanResult<{ changed: boolean; approximate: boolean }>> {
  const actor = await requireRole("ADMIN");
  return reorderStopsWith(
    { db: getDb(), actorId: actor.id, provider: getRoutingProvider(), loadSettings: getSettings },
    input,
  );
}

/** Admin-only: lock / unlock an unreleased tour. `{tourId, locked}`. */
export async function setTourLockedAction(input: unknown): Promise<PlanResult> {
  const actor = await requireRole("ADMIN");
  return setTourLockedWith(getDb(), actor.id, input);
}

/** Admin-only: assign an active driver (`driverId: null` clears it). `{tourId, driverId}`. */
export async function assignDriverAction(input: unknown): Promise<PlanResult> {
  const actor = await requireRole("ADMIN");
  return assignDriverWith(getDb(), actor.id, input);
}

/** Admin-only: release the tour to its driver. `{tourId, version}` (version from the page). */
export async function releaseTourAction(
  input: unknown,
): Promise<PlanResult<{ releasedAt: string; stopCount: number }>> {
  const actor = await requireRole("ADMIN");
  return releaseTourWith(getDb(), actor.id, input);
}

/**
 * Admin-only: re-release a RELEASED / IN_PROGRESS tour whose orders changed (NUD-043). The stops
 * are updated to the current confirmed orders (completed stops are never reset) and the driver
 * sees the update. `{tourId, version}` (version from the page, as for the first release).
 */
export async function reReleaseTourAction(input: unknown): Promise<PlanResult<ReReleaseOk>> {
  const actor = await requireRole("ADMIN");
  return reReleaseTourWith(
    { db: getDb(), actorId: actor.id, provider: getRoutingProvider(), loadSettings: getSettings },
    input,
  );
}

/**
 * Admin-only "Bearbeiten" (NUD-135, D29): driver, order of the pending stops and moves of stops to
 * another tour of the same date, also on released tours (revision +1, the driver sees "tour was
 * updated"). `{tourId, version, driverId, orderedStopIds, moves}`; the date is not editable and a
 * COMPLETED tour or a completed stop is refused.
 */
export async function editTourAction(input: unknown): Promise<PlanResult<EditTourOk>> {
  const actor = await requireRole("ADMIN");
  return editTourWith(
    { db: getDb(), actorId: actor.id, provider: getRoutingProvider(), loadSettings: getSettings },
    input,
  );
}

/** Admin-only: the "+ Tour" tab, an empty tour for the day (`{date}`); stops come by moving them. */
export async function createEmptyTourAction(input: unknown): Promise<CreateEmptyTourResult> {
  const actor = await requireRole("ADMIN");
  return createEmptyTourWith(
    {
      db: getDb(),
      actorId: actor.id,
      requireDepot: requireDepotConfigured,
      loadSettings: getSettings,
    },
    input,
  );
}
