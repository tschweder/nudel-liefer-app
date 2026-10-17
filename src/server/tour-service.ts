import type { PrismaClient } from "@/generated/prisma/client";

import { getDb } from "./db";

/**
 * Hook point between orders and tours (NUD-032). Every order create / update / cancel / duplicate
 * calls `markOutdatedForDate(date)` for each affected delivery day. For now it only flags the
 * existing tours of that day as outdated; NUD-043 extends it (outdated banner, rebuild rules).
 * Completed tours are left alone: they are history.
 */
export type TourService = {
  /** Flags the not yet completed tours of `date` as outdated; returns how many were changed. */
  markOutdatedForDate(date: Date): Promise<number>;
};

export function createTourService(db: Pick<PrismaClient, "tour">): TourService {
  return {
    async markOutdatedForDate(date) {
      const result = await db.tour.updateMany({
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
