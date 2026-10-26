import { z } from "zod";

import { addressQuery } from "@/domain/customer";
import { GEOCODE_BATCH_SIZE } from "@/domain/customer-import";
import type { PrismaClient } from "@/generated/prisma/client";
import { roundCoord } from "@/lib/coords";

import { type Geocoder, GeocoderError, MAX_ADDRESS_LENGTH } from "./geocoder";
import { createThrottle } from "./throttle";

type PinDb = Pick<PrismaClient, "customer">;

export const GEOCODE_BATCH_MAX = GEOCODE_BATCH_SIZE;
/** Upper bound of one work list / review queue. */
export const PIN_LIST_LIMIT = 2000;
/** The ORS free tier allows about 100 geocoding requests per minute: one request per 700 ms. */
export const DEFAULT_GEOCODE_DELAY_MS = 700;
const LOW_CONFIDENCE = 0.5;
const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * Pause between two geocoder calls. `GEOCODE_BATCH_DELAY_MS` wins; otherwise 700 ms with a real
 * provider (`ORS_API_KEY` set) and none for the Fake, which makes no network calls.
 */
export function geocodeDelayMs(env: Record<string, string | undefined> = process.env): number {
  const configured = env.GEOCODE_BATCH_DELAY_MS?.trim();
  if (configured && /^\d{1,5}$/.test(configured)) return Math.min(Number(configured), 10_000);
  return env.ORS_API_KEY?.trim() ? DEFAULT_GEOCODE_DELAY_MS : 0;
}

let sharedThrottle: { delay: number; wait: () => Promise<void> } | undefined;
/** One throttle per process, so concurrent batches share the budget. */
function defaultWait(): () => Promise<void> {
  const delay = geocodeDelayMs();
  if (!sharedThrottle || sharedThrottle.delay !== delay) {
    sharedThrottle = { delay, wait: createThrottle(delay) };
  }
  return sharedThrottle.wait;
}

/** Active customers that still have no Adresspunkt (work list of the geocoding step), by customer number. */
export async function listCustomerIdsWithoutPin(db: PinDb): Promise<string[]> {
  const rows = await db.customer.findMany({
    where: { active: true, lat: null },
    orderBy: { customerNumber: "asc" },
    take: PIN_LIST_LIMIT,
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

const idsSchema = z.array(z.string().trim().min(1).max(64)).min(1).max(GEOCODE_BATCH_MAX);

export type GeocodeStatus = "found" | "not_found" | "failed" | "skipped";
export type GeocodeOutcome = { id: string; status: GeocodeStatus; lowConfidence: boolean };
export type GeocodeBatchResult =
  | {
      ok: true;
      outcomes: GeocodeOutcome[];
      /** Why the batch ended early; the remaining ids were not tried. */
      stopped: null | "rate_limited" | "unavailable";
    }
  | { ok: false; error: "invalid" };

function isRateLimit(error: unknown): boolean {
  // 429 = per-minute limit, 403 = quota exhausted (ORS answers 403 when the daily quota is used up).
  return error instanceof GeocoderError && (error.status === 429 || error.status === 403);
}

/**
 * Looks up the Adresspunkt for up to five customers, one geocoder call at a time with a pause
 * between calls. The best hit is stored as the customer's Adresspunkt (no confirmation step, D22);
 * only customers that are active and have no point yet are touched (a point set in the meantime
 * wins). Stops at the first rate-limit answer or after three failures in a row.
 * Logs a summary line, never addresses. The caller checked the role.
 */
export async function geocodeCustomers(
  db: PinDb,
  geocoder: Geocoder,
  rawIds: unknown,
  options: { wait?: () => Promise<void> } = {},
): Promise<GeocodeBatchResult> {
  const parsed = idsSchema.safeParse(rawIds);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const wait = options.wait ?? defaultWait();
  const outcomes: GeocodeOutcome[] = [];
  let stopped: "rate_limited" | "unavailable" | null = null;
  let failures = 0;

  for (const id of [...new Set(parsed.data)]) {
    const customer = await db.customer.findFirst({
      where: { id, active: true, lat: null },
      select: { street: true, postalCode: true, city: true, country: true },
    });
    if (!customer) {
      outcomes.push({ id, status: "skipped", lowConfidence: false });
      continue;
    }
    await wait();
    try {
      const candidates = await geocoder.search(addressQuery(customer, MAX_ADDRESS_LENGTH));
      failures = 0;
      const best = candidates[0];
      if (!best) {
        outcomes.push({ id, status: "not_found", lowConfidence: false });
        continue;
      }
      await db.customer.updateMany({
        where: { id, lat: null },
        data: { lat: roundCoord(best.lat), lng: roundCoord(best.lng) },
      });
      outcomes.push({ id, status: "found", lowConfidence: best.confidence < LOW_CONFIDENCE });
    } catch (error) {
      if (!(error instanceof GeocoderError)) throw error;
      console.warn(`[customer-import] geocoding failed: ${error.code} ${error.status ?? ""}`);
      if (isRateLimit(error)) {
        stopped = "rate_limited";
        break;
      }
      outcomes.push({ id, status: "failed", lowConfidence: false });
      failures += 1;
      if (failures >= MAX_CONSECUTIVE_FAILURES) {
        stopped = "unavailable";
        break;
      }
    }
  }
  const count = (status: GeocodeStatus) => outcomes.filter((o) => o.status === status).length;
  console.info(
    `[customer-import] geocoded batch: found ${count("found")}, not found ${count("not_found")}, failed ${count("failed")}, skipped ${count("skipped")}${stopped ? `, stopped (${stopped})` : ""}`,
  );
  return { ok: true, outcomes, stopped };
}

// ---------------------------------------------------------------------------------------------
// Parkplatz queue (NUD-141)

export type ParkingQueueItem = {
  id: string;
  customerNumber: string;
  name: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
  /** The Adresspunkt, where the map starts; `null` when geocoding found nothing. */
  lat: number | null;
  lng: number | null;
  /** Version token: a changed customer restarts the queue. */
  updatedAt: string;
};

const withoutParking = { active: true, parkingSpots: { none: { active: true } } } as const;

/** Active customers without an active Parkplatz (delivered to the address), by customer number. */
export async function listParkingQueue(db: PinDb): Promise<ParkingQueueItem[]> {
  const rows = await db.customer.findMany({
    where: withoutParking,
    orderBy: { customerNumber: "asc" },
    take: PIN_LIST_LIMIT,
    select: {
      id: true,
      customerNumber: true,
      name: true,
      street: true,
      postalCode: true,
      city: true,
      country: true,
      lat: true,
      lng: true,
      updatedAt: true,
    },
  });
  return rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() }));
}

export async function countParkingQueue(db: PinDb): Promise<number> {
  return db.customer.count({ where: withoutParking });
}
