import { z } from "zod";

import { parseCalendarDate } from "@/domain/order";
import { isReleasedStatus } from "@/domain/tour-status";
import type { PrismaClient } from "@/generated/prisma/client";

import { readStopItems } from "./tour-rerelease";

/**
 * Read model of the driver's tour (data layer for NUD-051; no page here). Rules that matter for
 * correct quantities (client priority 2):
 *
 * - Only tours that were released (RELEASED / IN_PROGRESS / COMPLETED) and assigned to this driver
 *   are visible; drafts and other drivers' tours are `null`.
 * - Quantities come from the snapshot stored on each stop (`Stop.items`), which only changes when
 *   the office releases again. An order edited after release is NOT visible here before that, so the
 *   driver never sees half-updated numbers without the "Tour was updated" notice.
 * - After a re-release `updated` is true, `revision` identifies it and the stops carry
 *   `change` (`ADDED` / `CHANGED`, `changedInRevision`, `previousItems`) for the highlight.
 *   The app remembers the last revision the driver has seen and highlights stops whose
 *   `changedInRevision` is higher; `removedCustomers` names the stops that were dropped.
 */

export type DriverStopItem = {
  productId: string;
  sku: string;
  /** `LocalizedText` JSON; pick the driver's locale with `pick`. */
  name: unknown;
  unit: string;
  quantityCents: number;
  /** Quantity before the last change of this stop (`null` when the stop is new or unchanged). */
  previousQuantityCents: number | null;
};

export type DriverStop = {
  id: string;
  sequence: number;
  customerId: string;
  status: "PENDING" | "DELIVERED" | "PROBLEM";
  etaAt: string | null;
  items: DriverStopItem[];
  change: "ADDED" | "CHANGED" | null;
  changedInRevision: number | null;
};

export type DriverTour = {
  id: string;
  date: string;
  status: "RELEASED" | "IN_PROGRESS" | "COMPLETED";
  /** 1 = first release; +1 for every re-release that changed something. */
  revision: number;
  /** True once the tour was re-released: show the "Tour was updated" banner. */
  updated: boolean;
  reReleasedAt: string | null;
  removedCustomers: Array<{ customerId: string; customerNumber: string; name: string }>;
  stops: DriverStop[];
};

const removedSchema = z.object({
  revision: z.number(),
  removed: z.array(
    z.object({ customerId: z.string(), customerNumber: z.string(), name: z.string() }),
  ),
});

/**
 * The released tour of `driverId` on `date` (`YYYY-MM-DD`), or `null`. The caller (NUD-051) has
 * checked that the session user is this driver (`requireRole("DRIVER")`).
 */
export async function getDriverTour(
  db: Pick<PrismaClient, "tour" | "product">,
  driverId: string,
  rawDate: string,
): Promise<DriverTour | null> {
  const date = parseCalendarDate(rawDate);
  if (!date) return null;
  const tour = await db.tour.findFirst({
    where: { date, driverId, status: { in: ["RELEASED", "IN_PROGRESS", "COMPLETED"] } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: { stops: { orderBy: { sequence: "asc" } } },
  });
  if (!tour || !isReleasedStatus(tour.status)) return null;

  const snapshots = tour.stops.map((s) => ({ stop: s, items: readStopItems(s.items) }));
  const productIds = new Set(snapshots.flatMap(({ items }) => items.map((i) => i.productId)));
  const products = new Map(
    (
      await db.product.findMany({
        where: { id: { in: [...productIds] } },
        select: { id: true, sku: true, name: true, unit: true },
      })
    ).map((p) => [p.id, p]),
  );
  const removed = removedSchema.safeParse(tour.lastChange);
  return {
    id: tour.id,
    date: rawDate,
    status: tour.status as DriverTour["status"],
    revision: tour.releaseRevision,
    updated: tour.reReleasedAt !== null,
    reReleasedAt: tour.reReleasedAt?.toISOString() ?? null,
    removedCustomers: removed.success ? removed.data.removed : [],
    stops: snapshots.map(({ stop, items }) => {
      const previous = new Map(
        readStopItems(stop.previousItems).map((i) => [i.productId, i.quantityCents]),
      );
      return {
        id: stop.id,
        sequence: stop.sequence,
        customerId: stop.customerId,
        status: stop.status,
        etaAt: stop.etaAt?.toISOString() ?? null,
        change: stop.changeKind,
        changedInRevision: stop.changedInRevision,
        items: items.map((i) => ({
          productId: i.productId,
          sku: products.get(i.productId)?.sku ?? "",
          name: products.get(i.productId)?.name ?? null,
          unit: products.get(i.productId)?.unit ?? "PACK",
          quantityCents: i.quantityCents,
          previousQuantityCents:
            stop.changeKind === "CHANGED" ? (previous.get(i.productId) ?? 0) : null,
        })),
      };
    }),
  };
}
