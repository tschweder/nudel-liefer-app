import { z } from "zod";

import { formatCalendarDate } from "@/domain/order";
import type { PrismaClient } from "@/generated/prisma/client";
import { type LocalizedText, localizedTextSchema } from "@/lib/localized-text";

import { readStopItems } from "./tour-rerelease";

/**
 * Read model of the printable packing list / load sheet (NUD-091). The quantities are the ones
 * the TOUR carries (`Stop.items`, written when the tour is built and when the office re-releases
 * it), never the live order lines: the sheet must match what the driver sees. If orders changed
 * since (`isOutdated`) the page warns instead of silently printing newer numbers.
 */

export type TourPrintStop = {
  id: string;
  sequence: number;
  /** Trip of the tour (NUD-147): 1 = first trip, higher numbers follow a reload at the depot. */
  trip: number;
  /** NUD-158: the vehicle that drives this stop's trip (after a switch another one); `null` = none yet. */
  vehicleName: string | null;
  customerNumber: string;
  name: string;
  street: string;
  postalCode: string;
  city: string;
  items: Array<{ productId: string; quantity: number }>;
};

export type TourPrintProduct = {
  id: string;
  sku: string;
  unit: string;
  sortOrder: number;
  /** `null` when the stored JSON is unusable; the sheet then shows the SKU. */
  name: LocalizedText | null;
};

export type TourPrint = {
  id: string;
  /** `YYYY-MM-DD` */
  date: string;
  status: "DRAFT" | "OPTIMIZED" | "RELEASED" | "IN_PROGRESS" | "COMPLETED";
  /** Orders changed after the tour was built / released: the printed quantities are out of date. */
  isOutdated: boolean;
  releaseRevision: number;
  driverName: string | null;
  depot: { name: string; address: string } | null;
  stops: TourPrintStop[];
  products: TourPrintProduct[];
};

const idSchema = z.string().trim().min(1).max(64);

// unbounded-ok: Tour.depotSnapshot JSON written by the server
const depotSchema = z.object({ name: z.string(), address: z.string() });

export function parseTourId(raw: unknown): string | null {
  const parsed = idSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** The tour with its stops in delivery order and the products on them, or `null`. */
export async function getTourPrint(db: PrismaClient, rawId: unknown): Promise<TourPrint | null> {
  const id = parseTourId(rawId);
  if (!id) return null;
  const tour = await db.tour.findUnique({
    where: { id },
    include: {
      driver: { select: { displayName: true } },
      vehicle: { select: { name: true } },
      stops: {
        orderBy: { sequence: "asc" },
        include: {
          vehicle: { select: { name: true } },
          customer: {
            select: {
              customerNumber: true,
              name: true,
              street: true,
              postalCode: true,
              city: true,
            },
          },
        },
      },
    },
  });
  if (!tour) return null;

  const stops: TourPrintStop[] = tour.stops.map((s) => ({
    id: s.id,
    sequence: s.sequence,
    trip: s.trip,
    vehicleName: s.vehicle?.name ?? tour.vehicle?.name ?? null,
    customerNumber: s.customer.customerNumber,
    name: s.customer.name,
    street: s.customer.street,
    postalCode: s.customer.postalCode,
    city: s.customer.city,
    items: readStopItems(s.items).map((i) => ({
      productId: i.productId,
      quantity: i.quantity,
    })),
  }));
  const productIds = [...new Set(stops.flatMap((s) => s.items.map((i) => i.productId)))];
  const products = await db.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, sku: true, unit: true, sortOrder: true, name: true },
  });
  const depot = depotSchema.safeParse(tour.depotSnapshot);
  return {
    id: tour.id,
    date: formatCalendarDate(tour.date),
    status: tour.status,
    isOutdated: tour.isOutdated,
    releaseRevision: tour.releaseRevision,
    driverName: tour.driver?.displayName ?? null,
    depot: depot.success ? depot.data : null,
    stops,
    products: products.map((p) => {
      const name = localizedTextSchema.safeParse(p.name);
      return {
        id: p.id,
        sku: p.sku,
        unit: p.unit,
        sortOrder: p.sortOrder,
        name: name.success ? name.data : null,
      };
    }),
  };
}
