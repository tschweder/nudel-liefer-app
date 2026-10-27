import { tripLoadsKg } from "@/domain/fleet";
import { tourLoadKg } from "@/domain/vehicle";
import { orderWeightKg } from "@/domain/weight";
import type { PrismaClient } from "@/generated/prisma/client";

import { readStopItems } from "./tour-rerelease";

export type TourLoads = {
  /** Everything on the tour's stops in kg. */
  totalKg: number;
  /** Kilograms per trip (index 0 = trip 1); one entry for a tour without reloads. */
  tripLoadsKg: number[];
  /** The heaviest trip: what the vehicle has to carry at once, compared with its capacity. */
  maxTripKg: number;
};

/**
 * Load of a tour in kg (NUD-146, NUD-147): the quantities the stops were built or re-released with
 * (`Stop.items`, the same snapshot the driver sees) times the weight per unit of each product
 * (NUD-138). Stops of every status count: the load is what the vehicle carries on the day. With
 * reload trips the capacity applies per trip, so the heaviest trip is what is compared.
 */
export async function tourLoadsOf(
  db: Pick<PrismaClient, "product">,
  stops: ReadonlyArray<{ items: unknown; trip?: number }>,
): Promise<TourLoads> {
  const lists = stops.map((s) => readStopItems(s.items));
  const ids = [...new Set(lists.flatMap((items) => items.map((i) => i.productId)))];
  if (ids.length === 0) {
    const empty = stops.length === 0 ? [] : [0];
    return { totalKg: 0, tripLoadsKg: empty, maxTripKg: 0 };
  }
  const products = (
    await db.product.findMany({
      where: { id: { in: ids } },
      select: { id: true, weightKgPerUnit: true },
    })
  ).map((p) => ({ id: p.id, weightKgPerUnit: p.weightKgPerUnit.toString() }));
  const perTrip = tripLoadsKg(
    stops.map((s, index) => ({
      trip: s.trip ?? 1,
      weightKg: orderWeightKg(lists[index]!, products),
    })),
  );
  return {
    totalKg: tourLoadKg(lists, products),
    tripLoadsKg: perTrip,
    maxTripKg: Math.max(0, ...perTrip),
  };
}

/** Total load of a tour in kg (all trips together). */
export async function tourLoadKgOf(
  db: Pick<PrismaClient, "product">,
  stops: ReadonlyArray<{ items: unknown; trip?: number }>,
): Promise<number> {
  return (await tourLoadsOf(db, stops)).totalKg;
}
