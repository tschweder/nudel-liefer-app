/**
 * Pure settings logic (no framework imports): delivery-date defaults and the depot guard that
 * tour building (NUD-041) calls before it does anything.
 */

/** ISO weekday numbers as stored in `Settings.deliveryWeekdays`: 1 = Monday ... 7 = Sunday. */
export const ISO_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

export type PlanningSettings = {
  timezone: string;
  deliveryWeekdays: readonly number[];
};

export type DepotSettings = {
  depotName: string;
  depotAddress: string;
  depotLat: number;
  depotLng: number;
  depotPinConfirmed: boolean;
};

export type Depot = { name: string; address: string; lat: number; lng: number };

/** Calendar day (year, month 1-12, day) of `now` in the given IANA time zone. */
export function calendarDayIn(now: Date, timeZone: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

/** ISO weekday (1 = Monday ... 7 = Sunday) of a `DATE` value held as UTC midnight. */
export function isoWeekday(date: Date): number {
  return ((date.getUTCDay() + 6) % 7) + 1;
}

/**
 * Default delivery date for new orders: the first configured delivery weekday strictly after
 * "today" in the factory time zone (orders are taken for the next delivery day, not for today).
 * Returned as a `DATE` value (UTC midnight, like `Order.deliveryDate`). Without any usable
 * delivery weekday it falls back to tomorrow.
 */
export function nextDeliveryDate(now: Date, settings: PlanningSettings): Date {
  const { y, m, d } = calendarDayIn(now, settings.timezone);
  const today = Date.UTC(y, m - 1, d);
  const allowed = new Set(settings.deliveryWeekdays);
  for (let offset = 1; offset <= 7; offset += 1) {
    const candidate = new Date(today + offset * 86_400_000);
    if (allowed.has(isoWeekday(candidate))) return candidate;
  }
  return new Date(today + 86_400_000);
}

/** The depot, or `null` while no confirmed pin exists (no row, or the seed placeholder). */
export function getDepot(settings: DepotSettings | null | undefined): Depot | null {
  if (!settings?.depotPinConfirmed) return null;
  if (!Number.isFinite(settings.depotLat) || !Number.isFinite(settings.depotLng)) return null;
  return {
    name: settings.depotName,
    address: settings.depotAddress,
    lat: settings.depotLat,
    lng: settings.depotLng,
  };
}

/** Thrown by `requireDepot`; UI/actions map `code` to a localized message. */
export class DepotNotSetError extends Error {
  readonly code = "DEPOT_NOT_SET" as const;
  constructor() {
    super("The depot pin is not set. Open Settings and confirm the depot location on the map.");
    this.name = "DepotNotSetError";
  }
}

/** Guard for tour building: returns the depot or throws `DepotNotSetError`. */
export function requireDepot(settings: DepotSettings | null | undefined): Depot {
  const depot = getDepot(settings);
  if (!depot) throw new DepotNotSetError();
  return depot;
}
