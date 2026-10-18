import { z } from "zod";

import {
  effectiveMutationTime,
  SYNC_MAX_BODY_BYTES,
  SYNC_MAX_ENTRIES,
  type SyncEntry,
  type SyncEntryResult,
  type SyncResponse,
  type SyncTourState,
} from "@/domain/driver-sync";
import { PROBLEM_NOTE_MAX, PROBLEM_REASONS } from "@/domain/stop-status";
import type { PrismaClient } from "@/generated/prisma/client";

import { type Actor, authErrorStatus, requireRole } from "./auth/guards";
import { getDb } from "./db";
import { scheduleProblemNoteTranslation } from "./problem-note-translation";
import { applyStopMutation, type StopStatusResult } from "./stop-status";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

const entryFields = {
  clientMutationId: z.uuid(),
  stopId: z.string().min(1).max(64),
  createdAt: z.iso.datetime({ offset: true }),
};

/** Strict: unknown fields are rejected, like the single mutation of NUD-053. */
export const syncRequestSchema = z.strictObject({
  entries: z
    .array(
      z.discriminatedUnion("type", [
        z.strictObject({ type: z.literal("delivered"), ...entryFields }),
        z.strictObject({
          type: z.literal("problem"),
          ...entryFields,
          reason: z.enum(PROBLEM_REASONS),
          note: z.string().max(PROBLEM_NOTE_MAX).optional(),
        }),
        z.strictObject({ type: z.literal("undo"), ...entryFields }),
      ]),
    )
    .min(1)
    .max(SYNC_MAX_ENTRIES),
});

type ActingDriver = Pick<Actor, "id" | "role" | "locale">;

export type ApplySyncDeps = {
  /** Called with every result; the default starts the German translation of problem notes. */
  afterApply?: (db: PrismaClient, result: StopStatusResult) => void;
};

/**
 * Applies a batch of queued stop mutations for `actor` (a DRIVER; the caller has run
 * `requireRole`). Rules:
 * - Entries are applied one by one in the order the driver made them (effective time, then request
 *   order), each through `applyStopMutation` (own transaction, per-date advisory lock, idempotent
 *   by `clientMutationId`). A replayed id is reported as `replayed`, not applied twice.
 * - `now` handed to `applyStopMutation` is the effective time of the tap (`effectiveMutationTime`),
 *   so `completedAt` and the undo window follow the driver, and the same value is the conflict
 *   cut-off: a stop the office changed after it is rejected with `changed_by_office`.
 * - A business rejection does not stop the batch; an unexpected error marks that entry (and later
 *   entries for the same stop, to keep their order) `retry` and the batch goes on with other stops.
 * - Returns the authoritative state of every stop of the touched tours.
 */
export async function applySyncBatch(
  db: PrismaClient,
  actor: ActingDriver,
  entries: readonly SyncEntry[],
  now: Date = new Date(),
  deps: ApplySyncDeps = {},
): Promise<SyncResponse> {
  const afterApply = deps.afterApply ?? scheduleProblemNoteTranslation;
  const ordered = entries
    .map((entry, index) => ({
      entry,
      index,
      at: effectiveMutationTime(new Date(entry.createdAt), now),
    }))
    .sort((a, b) => a.at.getTime() - b.at.getTime() || a.index - b.index);

  const results = new Map<string, SyncEntryResult>();
  const failedStops = new Set<string>();
  for (const { entry, at } of ordered) {
    if (results.has(entry.clientMutationId)) continue; // the same id twice in one request
    if (failedStops.has(entry.stopId)) {
      results.set(entry.clientMutationId, {
        clientMutationId: entry.clientMutationId,
        outcome: "retry",
      });
      continue;
    }
    const mutation: Record<string, unknown> = { ...entry };
    delete mutation.createdAt; // `applyStopMutation` is strict: the time goes in as `now`
    let result: StopStatusResult;
    try {
      result = await applyStopMutation(db, actor, mutation, at, { clientCreatedAt: at });
    } catch {
      failedStops.add(entry.stopId);
      results.set(entry.clientMutationId, {
        clientMutationId: entry.clientMutationId,
        outcome: "retry",
      });
      continue;
    }
    if (result.ok) {
      afterApply(db, result);
      results.set(entry.clientMutationId, {
        clientMutationId: entry.clientMutationId,
        outcome: result.replayed ? "replayed" : "applied",
      });
    } else {
      results.set(entry.clientMutationId, {
        clientMutationId: entry.clientMutationId,
        outcome: "rejected",
        error: result.error,
      });
    }
  }

  return {
    results: entries.map((e) => results.get(e.clientMutationId)!),
    tours: await touchedTours(db, actor, entries),
    serverTime: now.toISOString(),
  };
}

/** Authoritative stop states of the driver's tours that contain a stop named in `entries`. */
async function touchedTours(
  db: PrismaClient,
  actor: ActingDriver,
  entries: readonly SyncEntry[],
): Promise<SyncTourState[]> {
  const stopIds = [...new Set(entries.map((e) => e.stopId))];
  const tours = await db.tour.findMany({
    // Only the driver's own tours: a foreign stop id reveals nothing.
    where: { driverId: actor.id, stops: { some: { id: { in: stopIds } } } },
    select: {
      id: true,
      status: true,
      stops: {
        orderBy: { sequence: "asc" },
        select: { id: true, status: true, problemReason: true, completedAt: true },
      },
    },
  });
  return tours.map((tour) => ({
    tourId: tour.id,
    status: tour.status,
    stops: tour.stops.map((s) => ({
      id: s.id,
      status: s.status,
      problemReason: s.problemReason,
      completedAt: s.completedAt?.toISOString() ?? null,
    })),
  }));
}

/**
 * `POST /api/driver/sync` (NUD-082). DRIVER only: `requireRole("DRIVER")` comes first (anonymous
 * -> 401, other roles -> 403); the driver is the session user, never a parameter. Body: JSON
 * `{ entries: [...] }` (zod, strict, 1..50 entries, <= 256 KiB). Answer: `SyncResponse`, never
 * cached. Cookie authentication plus the JSON-only content type keep it out of reach of
 * cross-site form posts (a cross-origin JSON request needs a CORS preflight, which is not granted).
 */
export async function driverSyncResponse(request: Request, now: Date = new Date()) {
  let actor;
  try {
    actor = await requireRole("DRIVER");
  } catch (error) {
    const status = authErrorStatus(error);
    if (!status) throw error;
    return Response.json(
      { error: status === 401 ? "unauthenticated" : "forbidden" },
      { status, headers: NO_STORE },
    );
  }
  const bad = (status: number, error: string) =>
    Response.json({ error }, { status, headers: NO_STORE });

  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return bad(415, "unsupported_media_type");
  }
  const text = await request.text();
  if (text.length > SYNC_MAX_BODY_BYTES) return bad(413, "too_large");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return bad(400, "invalid");
  }
  const parsed = syncRequestSchema.safeParse(json);
  if (!parsed.success) return bad(400, "invalid");

  const body = await applySyncBatch(getDb(), actor, parsed.data.entries, now);
  return Response.json(body, { headers: NO_STORE });
}
