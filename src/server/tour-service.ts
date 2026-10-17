import { canTransition, deriveTourStatus } from "@/domain/tour-status";
import type { PrismaClient } from "@/generated/prisma/client";

import { getDb } from "./db";

/** The part of a Prisma client (or transaction client) the tour service writes through. */
export type TourDb = Pick<PrismaClient, "tour">;

/**
 * Hook point between orders and tours (NUD-032, refined by NUD-043). Order mutations decide with
 * `outdatedTourDates` (src/domain/tour-diff.ts) which delivery days a change really affects
 * (only CONFIRMED orders count) and call `markOutdatedForDate` for each of them inside the same
 * transaction as the order write, so a saved order change can never exist without its flag.
 * Completed tours are left alone: they are history.
 */
export type TourService = {
  /**
   * Flags the not yet completed tours of `date` as outdated; returns how many were changed. Pass
   * the transaction client of the order write as `client` to make the flag atomic with it.
   */
  markOutdatedForDate(date: Date, client?: TourDb): Promise<number>;
};

export function createTourService(db: TourDb): TourService {
  return {
    async markOutdatedForDate(date, client = db) {
      const result = await client.tour.updateMany({
        where: { date, isOutdated: false, status: { not: "COMPLETED" } },
        data: { isOutdated: true },
      });
      return result.count;
    },
  };
}

/** The service bound to the application database (what the server actions pass in). */
export function getTourService(): TourService {
  return createTourService(getDb());
}

/**
 * Moves a released tour along its status machine after stops changed (a stop was completed, a
 * re-release removed or added stops): RELEASED -> IN_PROGRESS when the first stop is done,
 * -> COMPLETED (`completedAt`) when all are. The driver actions of NUD-051 call this inside the
 * transaction that writes the stop status. Returns the status the tour has afterwards.
 */
export async function syncTourProgress(
  tx: Pick<PrismaClient, "tour" | "stop">,
  tourId: string,
  now: Date = new Date(),
): Promise<string | null> {
  const tour = await tx.tour.findUnique({
    where: { id: tourId },
    select: { status: true, stops: { select: { status: true } } },
  });
  if (!tour) return null;
  const next = deriveTourStatus(
    tour.status,
    tour.stops.map((s) => s.status),
  );
  if (next === tour.status) return tour.status;
  if (!canTransition(tour.status, next)) {
    throw new Error(`Illegal tour transition ${tour.status} -> ${next}`);
  }
  await tx.tour.update({
    where: { id: tourId },
    data: { status: next, ...(next === "COMPLETED" ? { completedAt: now } : {}) },
  });
  return next;
}
