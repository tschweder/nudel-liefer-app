import { z } from "zod";

import { neighbourStops } from "@/domain/driver-stop";
import type { PhotoKind } from "@/domain/photos";
import { calendarDayIn } from "@/domain/settings";

import {
  type AppLocale,
  type LocalizedText,
  localizedTextSchema,
  pick,
  pickWithSource,
} from "./localized-text";

/**
 * The one data model of the driver screens (NUD-081). `GET /api/driver/tour/today` returns a
 * `DriverTourResponse`; the browser keeps exactly this JSON in IndexedDB. The "today" list and the
 * stop detail are derived from it by the pure functions below, in the server pages (online) and in
 * the offline shell alike, so both render the same screens from the same data.
 *
 * Texts that depend on the language travel as `LocalizedText` (all four locales) and are picked
 * with the viewer's locale at render time; customer names and addresses are never translated.
 */

export const DRIVER_TOUR_SCHEMA_VERSION = 1;

const idSchema = z.string().min(1).max(64);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const payloadPhotoSchema = z.object({
  id: idSchema,
  /** Signed storage URL, valid for the whole working day (see `DRIVER_PHOTO_URL_TTL_SECONDS`). */
  url: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type PayloadPhoto = z.infer<typeof payloadPhotoSchema>;

/**
 * Payloads cached by a phone before NUD-137 carry hundredths as `quantityCents` /
 * `previousQuantityCents`. Read them as whole numbers so an installed app keeps working offline
 * until the next successful refresh replaces the cache.
 */
function upgradeLegacyItem(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  const item = value as Record<string, unknown>;
  if (typeof item.quantityCents !== "number" || "quantity" in item) return value;
  const { quantityCents, previousQuantityCents, ...rest } = item;
  return {
    ...rest,
    quantity: Math.round((quantityCents as number) / 100),
    previousQuantity:
      typeof previousQuantityCents === "number" ? Math.round(previousQuantityCents / 100) : null,
  };
}

export const payloadItemSchema = z.preprocess(
  upgradeLegacyItem,
  z.object({
    productId: idSchema,
    sku: z.string(),
    /** `null` when the product has no (valid) name; the SKU is shown instead. */
    name: localizedTextSchema.nullable(),
    unit: z.string(),
    quantity: z.number().int(),
    previousQuantity: z.number().int().nullable(),
  }),
);

export const payloadStopSchema = z.object({
  id: idSchema,
  sequence: z.number().int(),
  status: z.enum(["PENDING", "DELIVERED", "PROBLEM"]),
  problemReason: z.string().nullable(),
  completedAt: z.string().nullable(),
  etaAt: z.string().nullable(),
  legDurationS: z.number().nullable(),
  change: z.enum(["ADDED", "CHANGED"]).nullable(),
  changedInRevision: z.number().int().nullable(),
  customerId: idSchema,
  customerNumber: z.string(),
  customerName: z.string(),
  street: z.string(),
  postalCode: z.string(),
  city: z.string(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  notes: localizedTextSchema.nullable(),
  deliveryHoursInfo: z.string().nullable(),
  photos: z.object({
    STORE: payloadPhotoSchema.nullable(),
    PARKING: payloadPhotoSchema.nullable(),
  }),
  items: z.array(payloadItemSchema),
});
export type PayloadStop = z.infer<typeof payloadStopSchema>;

export const driverTourSchema = z.object({
  id: idSchema,
  status: z.enum(["RELEASED", "IN_PROGRESS", "COMPLETED"]),
  /** 1 = first release; +1 per re-release that changed something (NUD-043). */
  revision: z.number().int(),
  updated: z.boolean(),
  removedCustomers: z.array(
    z.object({ customerId: z.string(), customerNumber: z.string(), name: z.string() }),
  ),
  stops: z.array(payloadStopSchema),
  depot: z.object({ name: z.string(), lat: z.number(), lng: z.number() }).nullable(),
  /** GeoJSON LineString coordinates `[lng, lat][]`. */
  geometry: z.array(z.tuple([z.number(), z.number()])).nullable(),
});
export type DriverTourData = z.infer<typeof driverTourSchema>;

export const driverTourResponseSchema = z.object({
  schemaVersion: z.literal(DRIVER_TOUR_SCHEMA_VERSION),
  /** Today in the factory time zone (`YYYY-MM-DD`): the day this answer is valid for. */
  date: dateSchema,
  /** Server time the answer was produced (ISO). */
  generatedAt: z.string(),
  timezone: z.string().min(1),
  serviceSecondsPerStop: z.number(),
  /** `null`: no tour released for this driver today. */
  tour: driverTourSchema.nullable(),
});
export type DriverTourResponse = z.infer<typeof driverTourResponseSchema>;

/** `YYYY-MM-DD` of `now` in the given IANA time zone. */
export function dayInTimezone(now: Date, timeZone: string): string {
  const { y, m, d } = calendarDayIn(now, timeZone);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------------------------
// Views derived from the model (what the screens render)
// ---------------------------------------------------------------------------------------------

/** One line of a stop, with the product name already picked in the driver's locale. */
export type TodayItem = {
  productId: string;
  name: string;
  /** German product name (matches the box labels); `null` when the product has none. */
  germanName: string | null;
  unit: string;
  quantity: number;
  previousQuantity: number | null;
};

export type TodayStop = {
  id: string;
  sequence: number;
  status: "PENDING" | "DELIVERED" | "PROBLEM";
  problemReason: string | null;
  completedAt: string | null;
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
  /**
   * Customer note for the driver, in the best language the device has (the note travels localized,
   * `LocalizedText`). `null` when the customer has none; optional so hand-built `TodayStop` values
   * (screens that never show a note) stay valid. Only the "today" list shows it as a strip.
   */
  noteText?: string | null;
  items: TodayItem[];
};

export type DriverToday = {
  tourId: string;
  date: string;
  tourStatus: DriverTourData["status"];
  revision: number;
  updated: boolean;
  removedCustomers: DriverTourData["removedCustomers"];
  stops: TodayStop[];
  depot: { name: string; lat: number; lng: number } | null;
  /** GeoJSON LineString coordinates `[lng, lat][]`. */
  geometry: Array<[number, number]> | null;
  serviceSecondsPerStop: number;
  timezone: string;
};

export type StopPhoto = { id: string; url: string; width: number; height: number };

export type DriverStopDetail = {
  tourId: string;
  tourStatus: DriverToday["tourStatus"];
  /** UI locale the texts were picked for. */
  locale: AppLocale;
  /** Factory time zone (for ETA display). */
  timezone: string;
  stop: TodayStop;
  /** 1-based position in the tour and number of stops. */
  position: number;
  total: number;
  prevStopId: string | null;
  nextStopId: string | null;
  /**
   * Every stop of the tour with its status, in tour order: after a stop is closed the screen goes
   * to the next open one, which depends on the stops closed offline too (NUD-082).
   */
  tourStops: Array<{
    id: string;
    sequence: number;
    status: TodayStop["status"];
    problemReason: string | null;
    completedAt: string | null;
  }>;
  /** Customer note for the driver in the best available language (`lang` = language it is in). */
  notes: { text: string; lang: AppLocale } | null;
  deliveryHoursInfo: string | null;
  photos: Record<PhotoKind, StopPhoto | null>;
};

function pickName(name: LocalizedText | null, sku: string, locale: AppLocale): string {
  return (name ? pickWithSource(name, locale)?.value : undefined) || sku;
}

function todayStop(stop: PayloadStop, locale: AppLocale): TodayStop {
  return {
    id: stop.id,
    sequence: stop.sequence,
    status: stop.status,
    problemReason: stop.problemReason,
    completedAt: stop.completedAt,
    etaAt: stop.etaAt,
    legDurationS: stop.legDurationS,
    change: stop.change,
    changedInRevision: stop.changedInRevision,
    customerId: stop.customerId,
    customerNumber: stop.customerNumber,
    customerName: stop.customerName,
    street: stop.street,
    postalCode: stop.postalCode,
    city: stop.city,
    lat: stop.lat,
    lng: stop.lng,
    noteText: stop.notes ? pick(stop.notes, locale).trim() || null : null,
    items: stop.items.map((item) => ({
      productId: item.productId,
      name: pickName(item.name, item.sku, locale),
      germanName: item.name?.de?.trim() ? item.name.de : null,
      unit: item.unit,
      quantity: item.quantity,
      previousQuantity: item.previousQuantity,
    })),
  };
}

/** The list screen model ("today's tour") for `locale`, or `null` when there is no tour. */
export function toDriverToday(response: DriverTourResponse, locale: AppLocale): DriverToday | null {
  const tour = response.tour;
  if (!tour) return null;
  return {
    tourId: tour.id,
    date: response.date,
    tourStatus: tour.status,
    revision: tour.revision,
    updated: tour.updated,
    removedCustomers: tour.removedCustomers,
    stops: tour.stops.map((stop) => todayStop(stop, locale)),
    depot: tour.depot,
    geometry: tour.geometry && tour.geometry.length > 1 ? tour.geometry : null,
    serviceSecondsPerStop: response.serviceSecondsPerStop,
    timezone: response.timezone,
  };
}

/**
 * The stop detail screen model, or `null` when the stop is not part of the tour. `photoUrl` maps a
 * photo to the URL the `<img>` loads: the signed storage URL online, the same-origin cache URL
 * (served by the service worker from Cache Storage) offline.
 */
export function toDriverStopDetail(
  response: DriverTourResponse,
  stopId: string,
  locale: AppLocale,
  photoUrl: (photo: PayloadPhoto) => string = (photo) => photo.url,
): DriverStopDetail | null {
  const tour = response.tour;
  const stop = tour?.stops.find((s) => s.id === stopId);
  if (!tour || !stop) return null;
  const nav = neighbourStops(tour.stops, stopId);
  if (!nav) return null;
  const notes = stop.notes ? pickWithSource(stop.notes, locale) : null;
  const photo = (p: PayloadPhoto | null): StopPhoto | null =>
    p ? { id: p.id, url: photoUrl(p), width: p.width, height: p.height } : null;
  return {
    tourId: tour.id,
    tourStatus: tour.status,
    locale,
    timezone: response.timezone,
    stop: todayStop(stop, locale),
    position: nav.position,
    total: nav.total,
    prevStopId: nav.prev?.id ?? null,
    nextStopId: nav.next?.id ?? null,
    tourStops: tour.stops.map((s) => ({
      id: s.id,
      sequence: s.sequence,
      status: s.status,
      problemReason: s.problemReason,
      completedAt: s.completedAt,
    })),
    notes: notes ? { text: notes.value, lang: notes.locale } : null,
    deliveryHoursInfo: stop.deliveryHoursInfo?.trim() || null,
    photos: { STORE: photo(stop.photos.STORE), PARKING: photo(stop.photos.PARKING) },
  };
}

/** Every photo of the tour (each once), the photos to prefetch for offline use. */
export function tourPhotos(response: DriverTourResponse): PayloadPhoto[] {
  const byId = new Map<string, PayloadPhoto>();
  for (const stop of response.tour?.stops ?? []) {
    for (const photo of [stop.photos.STORE, stop.photos.PARKING]) {
      if (photo) byId.set(photo.id, photo);
    }
  }
  return [...byId.values()];
}
