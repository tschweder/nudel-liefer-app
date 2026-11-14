import { canTransition, deriveTourStatus } from "@/domain/tour-status";
import type { PrismaClient } from "@/generated/prisma/client";

import { loadDayRoutes } from "./day-routes";
import { getDb } from "./db";

/** The part of a Prisma client (or transaction client) the tour service writes through. */
export type TourDb = Pick<
  PrismaClient,
  "tour" | "standingTour" | "order" | "customer" | "settings"
>;

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
   * the day belongs to that tour only, so only those tours are flagged. A customer on no open stop
   * may still be planned onto any open tour of the old flow, so those are all flagged; a tour of
   * a day route (NUD-212, `standingTourId`) is flagged only when the customer lands on that
   * route (a member of the standing tour, or an extra placed on it). Without this option (or
   * with an empty list) every open tour of the day is flagged.
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
          select: { id: true, standingTourId: true, stops: { select: { customerId: true } } },
        });
        const owned = new Set<string>();
        const unattached: string[] = [];
        for (const customerId of customerIds) {
          const owners = open.filter((t) => t.stops.some((s) => s.customerId === customerId));
          if (owners.length === 0) unattached.push(customerId);
          for (const t of owners) owned.add(t.id);
        }
        if (unattached.length > 0) {
          for (const t of open) if (t.standingTourId === null) owned.add(t.id);
          const routeOf = open.some((t) => t.standingTourId !== null)
            ? await dayRouteOf(client, date)
            : new Map<string, string>();
          for (const customerId of unattached) {
            const route = routeOf.get(customerId);
            for (const t of open) if (route && t.standingTourId === route) owned.add(t.id);
          }
        }
        ownerTourIds = [...owned];
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

/**
 * NUD-212: the route each customer of the day rides on (standing tour id): the members of a
 * standing tour and the extras placed on it. A customer without an order with a quantity, or
 * without any location, is on no route.
 */
async function dayRouteOf(client: TourDb, date: Date): Promise<Map<string, string>> {
  const settings = await client.settings.findUnique({
    where: { id: 1 },
    select: { depotLat: true, depotLng: true },
  });
  const plan = await loadDayRoutes(
    client,
    date,
    settings ? { lat: settings.depotLat, lng: settings.depotLng } : null,
  );
  const routeOf = new Map<string, string>();
  for (const route of plan.routes) {
    for (const customerId of route.order) routeOf.set(customerId, route.id);
  }
  return routeOf;
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
