import { neighbourStops } from "@/domain/driver-stop";
import type { PhotoKind } from "@/domain/photos";
import type { PrismaClient } from "@/generated/prisma/client";
import { type AppLocale, localizedTextSchema, pickWithSource } from "@/lib/localized-text";

import { type Actor, requireRole } from "./auth/guards";
import { type CustomerPhotoView, getCustomerPhotos } from "./customer-photos";
import { getDb } from "./db";
import { type DriverToday, getDriverToday, type TodayStop } from "./driver-today";
import { getSettings } from "./settings";
import { getStorage } from "./storage";
import type { Storage } from "./storage/types";

export type StopPhoto = { url: string; width: number; height: number };

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
  /** Customer note for the driver in the best available language (`lang` = language it is in). */
  notes: { text: string; lang: AppLocale } | null;
  deliveryHoursInfo: string | null;
  photos: Record<PhotoKind, StopPhoto | null>;
};

type Db = Pick<PrismaClient, "tour" | "product" | "customer" | "photo">;

function photoView(p: CustomerPhotoView | null): StopPhoto | null {
  return p ? { url: p.url, width: p.width, height: p.height } : null;
}

/**
 * The detail of one stop of the tour `actor` drives today. Authorization by construction: the stop
 * is looked up inside the actor's own released tour of today (`getDriverToday`), so any other
 * stop id (another driver's, another day, unreleased) yields `null`. Quantities are the released
 * snapshot, i.e. the merged quantities of the stop's confirmed orders at release time.
 */
export async function getDriverStopDetail(
  db: Db,
  storage: Pick<Storage, "getReadUrl">,
  actor: Pick<Actor, "id" | "role" | "locale">,
  options: {
    now: Date;
    timezone: string;
    serviceMinutesPerStop: number;
    locale?: AppLocale;
    stopId: string;
  },
): Promise<DriverStopDetail | null> {
  const today = await getDriverToday(db, actor, options);
  if (!today) return null;
  const stop = today.stops.find((s) => s.id === options.stopId);
  const nav = neighbourStops(today.stops, options.stopId);
  if (!stop || !nav) return null;
  const locale = options.locale ?? (actor.locale as AppLocale);

  const [customer, photos] = await Promise.all([
    db.customer.findUnique({
      where: { id: stop.customerId },
      select: { notes: true, deliveryHoursInfo: true },
    }),
    getCustomerPhotos(db, storage, stop.customerId),
  ]);

  const parsed = localizedTextSchema.safeParse(customer?.notes);
  const picked = parsed.success ? pickWithSource(parsed.data, locale) : null;
  return {
    tourId: today.tourId,
    tourStatus: today.tourStatus,
    locale,
    timezone: today.timezone,
    stop,
    position: nav.position,
    total: nav.total,
    prevStopId: nav.prev?.id ?? null,
    nextStopId: nav.next?.id ?? null,
    notes: picked ? { text: picked.value, lang: picked.locale } : null,
    deliveryHoursInfo: customer?.deliveryHoursInfo?.trim() || null,
    photos: { STORE: photoView(photos.STORE), PARKING: photoView(photos.PARKING) },
  };
}

/** Page query: `requireRole` first, then the stop inside the actor's own tour of today. */
export async function driverStopQuery(
  locale: AppLocale,
  stopId: string,
): Promise<DriverStopDetail | null> {
  const actor = await requireRole("ADMIN", "DRIVER");
  const settings = await getSettings();
  return getDriverStopDetail(getDb(), getStorage(), actor, {
    now: new Date(),
    timezone: settings?.timezone ?? "Europe/Vienna",
    serviceMinutesPerStop: settings?.serviceMinutesPerStop ?? 10,
    locale,
    stopId,
  });
}
