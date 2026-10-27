import { tourLoadKg } from "@/domain/vehicle";
import type { PrismaClient } from "@/generated/prisma/client";

import { readStopItems } from "./tour-rerelease";

/**
 * Load of a tour in kg (NUD-146): the quantities the stops were built or re-released with
 * (`Stop.items`, the same snapshot the driver sees) times the weight per unit of each product
 * (NUD-138). Stops of every status count: the load is what the vehicle carries on the day.
 */
export async function tourLoadKgOf(
  db: Pick<PrismaClient, "product">,
  stops: ReadonlyArray<{ items: unknown }>,
): Promise<number> {
  const lists = stops.map((s) => readStopItems(s.items));
  const ids = [...new Set(lists.flatMap((items) => items.map((i) => i.productId)))];
  if (ids.length === 0) return 0;
  const products = await db.product.findMany({
    where: { id: { in: ids } },
    select: { id: true, weightKgPerUnit: true },
  });
  return tourLoadKg(
    lists,
    products.map((p) => ({ id: p.id, weightKgPerUnit: p.weightKgPerUnit.toString() })),
  );
}
