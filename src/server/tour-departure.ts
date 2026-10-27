import { z } from "zod";

import type { PrismaClient } from "@/generated/prisma/client";

import { recordAudit } from "./audit";
import type { Actor } from "./auth/guards";

/**
 * The driver's departure checklist timestamps (NUD-151, F3, D28): `Tour.loadingStartedAt` when he
 * opens the checklist, `Tour.departedAt` when he taps "Losfahren" (or skips the checklist: then
 * only `departedAt` is written). Both arrive through the offline queue (`POST /api/driver/sync`,
 * types `loading` and `depart`), so they work without a connection and carry the time of the tap.
 *
 * The queue entries are keyed by a stop (the idempotency table `StopMutation` belongs to stops):
 * the entry names any stop of the tour, the server resolves the tour from it. First write wins: a
 * second `loading` / `depart` (a second device, a replay with a new id) changes nothing.
 */
const entrySchema = z.strictObject({
  type: z.enum(["loading", "depart"]),
  clientMutationId: z.uuid(),
  stopId: z.string().min(1).max(64),
});

export type DriverDepartureError = "invalid" | "forbidden" | "not_found" | "mutation_conflict";
export type DriverDepartureResult =
  { ok: true; replayed: boolean } | { ok: false; error: DriverDepartureError };

type ActingDriver = Pick<Actor, "id" | "role">;
type DepartureDb = Pick<PrismaClient, "$transaction">;

export async function applyDriverDeparture(
  db: DepartureDb,
  actor: ActingDriver,
  rawEntry: unknown,
  now: Date = new Date(),
  options: { clientCreatedAt?: Date } = {},
): Promise<DriverDepartureResult> {
  const parsed = entrySchema.safeParse(rawEntry);
  if (!parsed.success) return { ok: false, error: "invalid" };
  if (actor.role !== "DRIVER") return { ok: false, error: "forbidden" };
  const entry = parsed.data;
  const kind = entry.type === "loading" ? "LOADING" : "DEPART";

  try {
    return await db.$transaction(async (tx): Promise<DriverDepartureResult> => {
      const recorded = await tx.stopMutation.findUnique({ where: { id: entry.clientMutationId } });
      if (recorded) {
        return recorded.kind === kind &&
          recorded.stopId === entry.stopId &&
          recorded.driverId === actor.id
          ? { ok: true, replayed: true }
          : { ok: false, error: "mutation_conflict" };
      }
      const stop = await tx.stop.findUnique({
        where: { id: entry.stopId },
        select: { tourId: true, tour: { select: { driverId: true } } },
      });
      // Foreign and unknown stops give the same answer: nothing is revealed about other tours.
      if (!stop || stop.tour.driverId !== actor.id) return { ok: false, error: "not_found" };

      const changed =
        entry.type === "loading"
          ? await tx.tour.updateMany({
              where: { id: stop.tourId, loadingStartedAt: null },
              data: { loadingStartedAt: now },
            })
          : await tx.tour.updateMany({
              where: { id: stop.tourId, departedAt: null },
              data: { departedAt: now },
            });
      if (changed.count > 0) {
        const tour = await tx.tour.findUniqueOrThrow({
          where: { id: stop.tourId },
          select: { loadingStartedAt: true },
        });
        await recordAudit(tx, {
          actorId: actor.id,
          entity: "Tour",
          entityId: stop.tourId,
          action: entry.type === "loading" ? "tour.loading_started" : "tour.departed",
          diff: {
            at: now.toISOString(),
            // Departing without ever opening the checklist = the checklist was skipped.
            ...(entry.type === "depart" ? { skipped: tour.loadingStartedAt === null } : {}),
            via: options.clientCreatedAt ? "sync" : "driver",
          },
        });
      }
      await tx.stopMutation.create({
        data: {
          id: entry.clientMutationId,
          stopId: entry.stopId,
          driverId: actor.id,
          kind,
          result: { ok: true, kind, changed: changed.count > 0 },
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
