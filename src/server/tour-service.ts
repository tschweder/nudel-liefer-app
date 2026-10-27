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
  markOutdatedForDate(date: Date, client?: TourDb, options?: MarkOutdatedOptions): Promise<number>;
};

export type MarkOutdatedOptions = {
  /**
   * NUD-154: the customers of the changed order(s). A customer that has a stop on an open tour of
   * the day belongs to that tour only, so only those tours are flagged; a customer on no open
   * stop may still be planned onto any open tour, so all open tours are flagged. Without this
   * option (or with an empty list) every open tour of the day is flagged.
   */
  customerIds?: readonly string[];
};

export function createTourService(db: TourDb): TourService {
  return {
    async markOutdatedForDate(date, client = db, options = {}) {
      const customerIds = options.customerIds ?? [];
      let ownerTourIds: string[] | null = null;
      if (customerIds.length > 0) {
        const open = await client.tour.findMany({
          where: { date, status: { not: "COMPLETED" } },
          select: { id: true, stops: { select: { customerId: true } } },
        });
        const owned = new Set<string>();
        let unattached = false;
        for (const customerId of customerIds) {
          const owners = open.filter((t) => t.stops.some((s) => s.customerId === customerId));
          if (owners.length === 0) unattached = true;
          for (const t of owners) owned.add(t.id);
        }
        if (!unattached) ownerTourIds = [...owned];
      }
      const result = await client.tour.updateMany({
        where: {
          date,
          isOutdated: false,
          status: { not: "COMPLETED" },
          ...(ownerTourIds ? { id: { in: ownerTourIds } } : {}),
        },
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
