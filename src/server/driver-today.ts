import { z } from "zod";

import { calendarDayIn } from "@/domain/settings";
import type { PrismaClient } from "@/generated/prisma/client";
import { type AppLocale, localizedTextSchema, pick } from "@/lib/localized-text";

import { type Actor, requireRole } from "./auth/guards";
import { getDb } from "./db";
import { getSettings } from "./settings";
import { type DriverTour, getDriverTour } from "./tour-driver";

/** One line of a stop, with the product name already picked in the driver's locale. */
export type TodayItem = {
  productId: string;
  name: string;
  /** German product name (matches the box labels); `null` when the product has none. */
  germanName: string | null;
  unit: string;
  quantityCents: number;
  previousQuantityCents: number | null;
};

export type TodayStop = {
  id: string;
  sequence: number;
  status: "PENDING" | "DELIVERED" | "PROBLEM";
  etaAt: string | null;
  legDurationS: number | null;
  change: "ADDED" | "CHANGED" | null;
  changedInRevision: number | null;
  customerId: string;
  /** Customer data is never translated (the driver matches it to real signage). */
  customerNumber: string;
  customerName: string;
  street: string;
  postalCode: string;
  city: string;
  lat: number | null;
  lng: number | null;
  items: TodayItem[];
};

export type DriverToday = {
  tourId: string;
  date: string;
  tourStatus: DriverTour["status"];
  revision: number;
  updated: boolean;
  removedCustomers: DriverTour["removedCustomers"];
  stops: TodayStop[];
  depot: { name: string; lat: number; lng: number } | null;
  /** GeoJSON LineString coordinates `[lng, lat][]`. */
  geometry: Array<[number, number]> | null;
  serviceSecondsPerStop: number;
  timezone: string;
};

const depotSchema = z.object({ name: z.string(), lat: z.number(), lng: z.number() });
const geometrySchema = z.object({ coordinates: z.array(z.tuple([z.number(), z.number()])) });

/** `YYYY-MM-DD` of `now` in the factory time zone. */
export function todayInTimezone(now: Date, timeZone: string): string {
  const { y, m, d } = calendarDayIn(now, timeZone);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

type Db = Pick<PrismaClient, "tour" | "product" | "customer">;

/**
 * The tour `actor` drives today (released, assigned to him, date = today in the factory time zone)
 * for the driver screen. The driver id always comes from the authenticated actor, never from a
 * request parameter; only an actual DRIVER has a tour (an admin in the support view sees none).
 */
export async function getDriverToday(
  db: Db,
  actor: Pick<Actor, "id" | "role" | "locale">,
  options: { now: Date; timezone: string; serviceMinutesPerStop: number; locale?: AppLocale },
): Promise<DriverToday | null> {
  if (actor.role !== "DRIVER") return null;
  const date = todayInTimezone(options.now, options.timezone);
  const tour = await getDriverTour(db, actor.id, date);
  if (!tour) return null;
  const locale = options.locale ?? (actor.locale as AppLocale);

  const [customers, row] = await Promise.all([
    db.customer.findMany({
      where: { id: { in: [...new Set(tour.stops.map((s) => s.customerId))] } },
      select: {
        id: true,
        customerNumber: true,
        name: true,
        street: true,
        postalCode: true,
        city: true,
        lat: true,
        lng: true,
      },
    }),
    db.tour.findUnique({
      where: { id: tour.id },
      select: { depotSnapshot: true, geometry: true },
    }),
  ]);
  const byId = new Map(customers.map((c) => [c.id, c]));
  const depot = depotSchema.safeParse(row?.depotSnapshot);
  const geometry = geometrySchema.safeParse(row?.geometry);

  return {
    tourId: tour.id,
    date: tour.date,
    tourStatus: tour.status,
    revision: tour.revision,
    updated: tour.updated,
    removedCustomers: tour.removedCustomers,
    stops: tour.stops.map((stop) => {
      const customer = byId.get(stop.customerId);
      return {
        id: stop.id,
        sequence: stop.sequence,
        status: stop.status,
        etaAt: stop.etaAt,
        legDurationS: stop.legDurationS,
        change: stop.change,
        changedInRevision: stop.changedInRevision,
        customerId: stop.customerId,
        customerNumber: customer?.customerNumber ?? "",
        customerName: customer?.name ?? "",
        street: customer?.street ?? "",
        postalCode: customer?.postalCode ?? "",
        city: customer?.city ?? "",
        lat: customer?.lat ?? null,
        lng: customer?.lng ?? null,
        items: stop.items.map((item) => {
          const name = localizedTextSchema.safeParse(item.name);
          return {
            productId: item.productId,
            name: name.success ? pick(name.data, locale) || item.sku : item.sku,
            germanName: name.success && name.data.de?.trim() ? name.data.de : null,
            unit: item.unit,
            quantityCents: item.quantityCents,
            previousQuantityCents: item.previousQuantityCents,
          };
        }),
      };
    }),
    depot: depot.success ? depot.data : null,
    geometry:
      geometry.success && geometry.data.coordinates.length > 1 ? geometry.data.coordinates : null,
    serviceSecondsPerStop: options.serviceMinutesPerStop * 60,
    timezone: options.timezone,
  };
}

/** Page query: `requireRole` first, then the actor's own tour for today. */
export async function driverTodayQuery(locale: AppLocale): Promise<DriverToday | null> {
  const actor = await requireRole("ADMIN", "DRIVER");
  const settings = await getSettings();
  return getDriverToday(getDb(), actor, {
    now: new Date(),
    timezone: settings?.timezone ?? "Europe/Vienna",
    serviceMinutesPerStop: settings?.serviceMinutesPerStop ?? 10,
    locale,
  });
}
