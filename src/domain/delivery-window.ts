import { isoWeekday } from "./settings";

/**
 * Requested delivery window of an order (NUD-148, D25): first and last day (factory time zone) and
 * an optional time of day on each end. `Order.deliveryDate` is the PLANNED day inside (or, moved by
 * the office, outside) the window. Pure rules, no framework imports.
 */

const DAY_MS = 86_400_000;
/** Longest window the office may enter (days, first and last included). */
export const MAX_WINDOW_DAYS = 31;

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "HH:MM" (24 h) to seconds since midnight; `null` for anything else. */
export function parseTimeOfDay(value: string): number | null {
  const match = TIME_PATTERN.exec(value.trim());
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 : null;
}

/** Seconds since midnight as "HH:MM". */
export function formatTimeOfDay(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds / 60));
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Seconds since midnight of `instant` in the given IANA time zone. */
export function secondsOfDayIn(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return get("hour") * 3600 + get("minute") * 60 + get("second");
}

export type OrderWindow = {
  from: Date;
  to: Date;
  fromTime: string | null;
  toTime: string | null;
};

/** True when `from <= to`, at most `MAX_WINDOW_DAYS` days, and a same-day window has start before end. */
export function isValidWindow(window: OrderWindow): boolean {
  const days = Math.round((window.to.getTime() - window.from.getTime()) / DAY_MS) + 1;
  if (days < 1 || days > MAX_WINDOW_DAYS) return false;
  const start = window.fromTime ? parseTimeOfDay(window.fromTime) : null;
  const end = window.toTime ? parseTimeOfDay(window.toTime) : null;
  if ((window.fromTime && start === null) || (window.toTime && end === null)) return false;
  if (days === 1 && start !== null && end !== null && start >= end) return false;
  return true;
}

export function isInsideWindow(day: Date, window: Pick<OrderWindow, "from" | "to">): boolean {
  return day.getTime() >= window.from.getTime() && day.getTime() <= window.to.getTime();
}

export type PlannedDayReason = "ok" | "no_capacity" | "no_delivery_day";

export type PlannedDayInput = {
  window: Pick<OrderWindow, "from" | "to">;
  /** Factory-time-zone "today" (`DATE` value); days before it are never planned. */
  today: Date;
  /** ISO weekdays (1 = Monday) on which the factory delivers. */
  deliveryWeekdays: readonly number[];
  /** Weight of the order in kg. */
  orderKg: number;
  /** kg already planned per day, key `YYYY-MM-DD`; a missing key is an empty day. */
  usedKgByDay: ReadonlyMap<string, number>;
  /** Total capacity of the active vehicles per day in kg; `null` = no vehicles known, unlimited. */
  capacityKg: number | null;
};

/**
 * Default planned day: the earliest day inside the window that is a delivery weekday and still has
 * vehicle capacity for the order. An empty day always accepts the order (an order heavier than
 * every vehicle is served by reload trips, not by skipping days). Without such a day: the earliest
 * delivery weekday of the window (`no_capacity`), and without any delivery weekday the first day
 * that is not in the past (`no_delivery_day`); both are warnings, never errors.
 */
export function pickPlannedDay(input: PlannedDayInput): { day: Date; reason: PlannedDayReason } {
  const start = Math.max(input.window.from.getTime(), input.today.getTime());
  const end = input.window.to.getTime();
  const allowed = new Set(input.deliveryWeekdays);
  let firstWeekday: Date | null = null;
  for (let t = start; t <= end; t += DAY_MS) {
    const day = new Date(t);
    if (!allowed.has(isoWeekday(day))) continue;
    firstWeekday ??= day;
    if (input.capacityKg === null) return { day, reason: "ok" };
    const used = input.usedKgByDay.get(day.toISOString().slice(0, 10)) ?? 0;
    if (used === 0 || used + input.orderKg <= input.capacityKg) return { day, reason: "ok" };
  }
  if (firstWeekday) return { day: firstWeekday, reason: "no_capacity" };
  return { day: new Date(Math.min(start, end)), reason: "no_delivery_day" };
}

export type TimeWindowS = { fromS: number; toS: number };

/**
 * Time-of-day constraint of one stop on `plannedDay` (seconds since midnight): the intersection of
 * the time parts of all its orders whose window contains that day. `null` = unconstrained;
 * `conflict` = the orders of the stop demand disjoint hours (the intersection is empty, the
 * returned bounds are the tightest start and end so the warning can still be shown).
 */
export function stopTimeWindow(
  windows: readonly OrderWindow[],
  plannedDay: Date,
): (TimeWindowS & { conflict: boolean }) | null {
  let fromS = 0;
  let toS = 86_399;
  let constrained = false;
  for (const w of windows) {
    if (!w.fromTime && !w.toTime) continue;
    if (!isInsideWindow(plannedDay, w)) continue;
    constrained = true;
    const start = w.fromTime ? (parseTimeOfDay(w.fromTime) ?? 0) : 0;
    const end = w.toTime ? (parseTimeOfDay(w.toTime) ?? 86_399) : 86_399;
    fromS = Math.max(fromS, start);
    toS = Math.min(toS, end);
  }
  return constrained ? { fromS, toS, conflict: fromS > toS } : null;
}

export type WindowViolation = "early" | "late" | "conflict";

/** Arrival (seconds since midnight) against a stop's time window; `null` when it is inside. */
export function checkArrival(
  arrivalS: number,
  window: (TimeWindowS & { conflict: boolean }) | null,
): WindowViolation | null {
  if (!window) return null;
  if (window.conflict) return "conflict";
  if (arrivalS < window.fromS) return "early";
  if (arrivalS > window.toS) return "late";
  return null;
}
