import { cacheLife, cacheTag } from "next/cache";
import { z } from "zod";

import {
  type Depot,
  type DepotSettings,
  nextDeliveryDate,
  type PlanningSettings,
  requireDepot,
} from "@/domain/settings";
import type { PrismaClient } from "@/generated/prisma/client";
import { roundCoord } from "@/lib/coords";
import { DEFAULT_TIMEZONE } from "@/lib/format";

import { getDb } from "./db";
import { MAX_ADDRESS_LENGTH } from "./geocoder";

/** Cache tag of the settings singleton; the save action expires it. */
export const SETTINGS_TAG = "settings";

export type AppSettings = DepotSettings &
  PlanningSettings & {
    departureTime: string;
    serviceMinutesPerStop: number;
    recurringLeadDays: number;
  };

const SETTINGS_ID = 1;

function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const settingsInputSchema = z.object({
  depotName: z.string().trim().min(1).max(120),
  depotAddress: z.string().trim().min(1).max(MAX_ADDRESS_LENGTH),
  depotLat: z.number().min(-90).max(90).transform(roundCoord),
  depotLng: z.number().min(-180).max(180).transform(roundCoord),
  /** The admin must tick "pin checked" (D9); anything else is rejected. */
  depotPinConfirmed: z.literal(true),
  timezone: z.string().trim().min(1).max(64).refine(isValidTimezone),
  departureTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  serviceMinutesPerStop: z.number().int().min(0).max(180),
  /** Days ahead the daily job generates recurring orders (NUD-149); omitted = unchanged. */
  recurringLeadDays: z.number().int().min(1).max(60).optional(),
  deliveryWeekdays: z
    .array(z.number().int().min(1).max(7))
    .min(1)
    .max(7)
    .transform((days) => [...new Set(days)].sort((a, b) => a - b)),
});

export type SettingsInput = z.input<typeof settingsInputSchema>;
export type SaveSettingsResult = { ok: true } | { ok: false; error: "invalid" };

type SettingsDb = Pick<PrismaClient, "settings">;

/** Reads the singleton row; `null` before the first save on a database without seed data. */
export async function readSettings(db: SettingsDb): Promise<AppSettings | null> {
  const row = await db.settings.findUnique({ where: { id: SETTINGS_ID } });
  if (!row) return null;
  return {
    depotName: row.depotName,
    depotAddress: row.depotAddress,
    depotLat: row.depotLat,
    depotLng: row.depotLng,
    depotPinConfirmed: row.depotPinConfirmed,
    timezone: row.timezone,
    departureTime: row.departureTime,
    serviceMinutesPerStop: row.serviceMinutesPerStop,
    recurringLeadDays: row.recurringLeadDays,
    deliveryWeekdays: row.deliveryWeekdays,
  };
}

/** Validates and stores the settings (upsert of the singleton). The caller checked the role. */
export async function saveSettings(db: SettingsDb, input: unknown): Promise<SaveSettingsResult> {
  const parsed = settingsInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const data = parsed.data;
  await db.settings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, ...data },
    update: data,
  });
  return { ok: true };
}

/**
 * Settings for pages and services, cached server-side and expired by `updateTag(SETTINGS_TAG)`
 * in the save action. Use `readSettings(getDb())` where an uncached read is required.
 */
export async function getSettings(): Promise<AppSettings | null> {
  "use cache";
  cacheTag(SETTINGS_TAG);
  cacheLife("hours");
  return readSettings(getDb());
}

/** Factory time zone from the settings (falls back to the default before the first save). */
export async function getFactoryTimezone(): Promise<string> {
  return (await getSettings())?.timezone ?? DEFAULT_TIMEZONE;
}

/**
 * Tour-building guard (NUD-041): the confirmed depot or a thrown `DepotNotSetError`
 * (`code === "DEPOT_NOT_SET"`) that the caller turns into a clear message.
 */
export async function requireDepotConfigured(): Promise<Depot> {
  return requireDepot(await getSettings());
}

/** Default delivery date for order entry (NUD-030), derived from the delivery weekdays. */
export async function getDefaultDeliveryDate(now: Date = new Date()): Promise<Date> {
  const settings = await getSettings();
  return nextDeliveryDate(now, {
    timezone: settings?.timezone ?? DEFAULT_TIMEZONE,
    deliveryWeekdays: settings?.deliveryWeekdays ?? [1, 2, 3, 4, 5],
  });
}
