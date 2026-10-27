import type { PrismaClient } from "@/generated/prisma/client";
import {
  dayInTimezone,
  type DriverToday,
  type TodayItem,
  type TodayStop,
  toDriverToday,
} from "@/lib/driver-tour-model";
import type { AppLocale } from "@/lib/localized-text";

import { type Actor, requireRole } from "./auth/guards";
import { getDb } from "./db";
import { getDriverTourResponse } from "./driver-tour-payload";
import { getSettings } from "./settings";

// The screen models live in the shared driver data model (NUD-081); re-exported for the screens.
export type { DriverToday, TodayItem, TodayStop };

/** `YYYY-MM-DD` of `now` in the factory time zone. */
export function todayInTimezone(now: Date, timeZone: string): string {
  return dayInTimezone(now, timeZone);
}

type Db = Pick<PrismaClient, "tour" | "product" | "customer" | "photo" | "settings">;

/**
 * The tour `actor` drives today (released, assigned to him, date = today in the factory time zone)
 * for the driver screen: the shared driver data model (`getDriverTourResponse`) with the texts
 * picked in the viewer's locale. The driver id always comes from the authenticated actor, never
 * from a request parameter; only an actual DRIVER has a tour (an admin in the support view sees none).
 */
export async function getDriverToday(
  db: Db,
  actor: Pick<Actor, "id" | "role" | "locale">,
  options: { now: Date; timezone: string; serviceMinutesPerStop: number; locale?: AppLocale },
): Promise<DriverToday | null> {
  const response = await getDriverTourResponse(db, actor, options);
  return toDriverToday(response, options.locale ?? (actor.locale as AppLocale));
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
