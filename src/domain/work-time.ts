/**
 * Driver working time and utilization (NUD-152, D28). Pure rules: a driver's working days and hours,
 * the measured working time of a tour, the comparison with the planned time and the planning warning
 * when a tour overruns a shift. No framework or database imports, no GPS (D19) — only the timestamps
 * the driver app already writes (`Tour.loadingStartedAt` / `Tour.departedAt`, `Stop.completedAt`) and
 * the planned route the tour carries (`Tour.totalDurationS`, `Stop.etaAt`).
 */
import { isoWeekday } from "./settings";
import { departureInstant } from "./tour";

export const MINUTES_PER_DAY = 24 * 60;
/** Longest shift we accept for a weekday in minutes (23:59); a shift never crosses midnight. */
export const MAX_SHIFT_MINUTES = MINUTES_PER_DAY - 1;
/** Upper bound of `Settings.defaultLoadingMinutes`, the same range as the settings form. */
export const MAX_DEFAULT_LOADING_MINUTES = 180;
/** Fallback for `Settings.defaultLoadingMinutes` before the settings row exists (same as the DB default). */
export const DEFAULT_LOADING_MINUTES = 20;

/** ISO weekday numbers, Monday first. */
export const ISO_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export type IsoWeekday = (typeof ISO_WEEKDAYS)[number];

/** One working day of a driver; `active = false` means "not working that weekday". */
export type ScheduleDay = {
  weekday: number;
  /** Minutes since midnight in the factory time zone. */
  startMinutes: number;
  endMinutes: number;
  active: boolean;
};
/** The stored rows of one driver — possibly partial: a weekday without a row is a non-working day. */
export type WorkSchedule = readonly ScheduleDay[];

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "HH:MM" to minutes since midnight; `null` for anything else. */
export function timeToMinutes(value: string): number | null {
  const match = TIME_PATTERN.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** Minutes since midnight to "HH:MM" (clamped into the day). */
export function minutesToTime(minutes: number): string {
  const clamped = Math.min(Math.max(Math.round(minutes), 0), MINUTES_PER_DAY - 1);
  const hours = Math.floor(clamped / 60);
  const rest = clamped % 60;
  return `${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

/** A day only counts when it is active and its hours are a real, same-day window. */
export function isValidDay(day: ScheduleDay): boolean {
  return (
    ISO_WEEKDAYS.includes(day.weekday as IsoWeekday) &&
    Number.isInteger(day.startMinutes) &&
    Number.isInteger(day.endMinutes) &&
    day.startMinutes >= 0 &&
    day.endMinutes <= MAX_SHIFT_MINUTES &&
    day.startMinutes < day.endMinutes
  );
}

/** The active, valid row of one ISO weekday, or `null` when the driver does not work that day. */
export function dayForWeekday(schedule: WorkSchedule, weekday: number): ScheduleDay | null {
  const day = schedule.find((entry) => entry.weekday === weekday);
  return day && day.active && isValidDay(day) ? day : null;
}

/** Working minutes of one day (0 for a non-working or invalid day). */
export function dayMinutes(day: ScheduleDay | null): number {
  return day && day.active && isValidDay(day) ? day.endMinutes - day.startMinutes : 0;
}

/** Contracted minutes per week: the sum over the weekdays the driver works. */
export function weekMinutes(schedule: WorkSchedule): number {
  return ISO_WEEKDAYS.reduce(
    (sum, weekday) => sum + dayMinutes(dayForWeekday(schedule, weekday)),
    0,
  );
}

/** Contracted minutes over an explicit list of ISO weekdays (a day, a week, a month). */
export function contractMinutes(schedule: WorkSchedule, weekdays: readonly number[]): number {
  return weekdays.reduce((sum, weekday) => sum + dayMinutes(dayForWeekday(schedule, weekday)), 0);
}

/**
 * The weekdays grouped into "same hours" runs, in ISO order: Monday to Friday 06:00–14:00 comes back
 * as one run `{ weekdays: [1..5], startMinutes: 360, endMinutes: 840 }`. The UI turns the runs into
 * text in the current language, so this module stays free of translations.
 */
export function summariseSchedule(
  schedule: WorkSchedule,
): Array<{ weekdays: number[]; startMinutes: number; endMinutes: number }> {
  const runs: Array<{ weekdays: number[]; startMinutes: number; endMinutes: number }> = [];
  for (const weekday of ISO_WEEKDAYS) {
    const day = dayForWeekday(schedule, weekday);
    if (!day) continue;
    const last = runs.at(-1);
    const continues =
      last &&
      last.endMinutes === day.endMinutes &&
      last.startMinutes === day.startMinutes &&
      last.weekdays.at(-1) === weekday - 1;
    if (continues) last.weekdays.push(weekday);
    else
      runs.push({
        weekdays: [weekday],
        startMinutes: day.startMinutes,
        endMinutes: day.endMinutes,
      });
  }
  return runs;
}

/**
 * Compact text of schedule runs for the driver list: "Mo–Fr 06:00–14:00". The weekday names come from
 * the caller (`weekdayName`), so the text follows the current language without messages here.
 */
export function formatScheduleRuns(
  runs: ReadonlyArray<{ weekdays: number[]; startMinutes: number; endMinutes: number }>,
  weekdayName: (weekday: number) => string,
): string {
  return runs
    .map((run) => {
      const first = weekdayName(run.weekdays[0] ?? 1);
      const last = weekdayName(run.weekdays.at(-1) ?? 1);
      const days = run.weekdays.length === 1 ? first : `${first}–${last}`;
      return `${days} ${minutesToTime(run.startMinutes)}–${minutesToTime(run.endMinutes)}`;
    })
    .join(", ");
}

/**
 * The calendar day ("YYYY-MM-DD") the wall clock in `timeZone` shows at `instant`. Used to reject a
 * measured tour that runs across midnight: its working time would belong to two calendar days.
 */
export function localCalendarDate(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** The settings the measurement needs (a subset of `AppSettings`, so this stays pure). */
export type WorkTimeSettings = {
  departureTime: string;
  serviceMinutesPerStop: number;
  defaultLoadingMinutes: number;
};

/** The tour facts the measurement reads: the timestamps the driver app wrote and the planned route. */
export type WorkTour = {
  /** `Tour.date`: a DATE value held as UTC midnight. */
  date: Date;
  loadingStartedAt: Date | null;
  departedAt: Date | null;
  /** `Tour.totalDurationS`: the planned driving, service and reload time, depot to depot. */
  totalDurationS: number | null;
  /** The stops in tour order (`Stop.etaAt` planned, `Stop.completedAt` written by the driver). */
  stops: ReadonlyArray<{ etaAt: Date | null; completedAt: Date | null }>;
};

/** Why a tour is left out of the utilization numbers. */
export type WorkRejectReason =
  "no_start" | "no_stops" | "not_completed" | "invalid_window" | "crosses_midnight";

export type MeasuredTourWork = {
  start: Date;
  end: Date;
  /**
   * "checklist": the driver opened the departure checklist (`Tour.loadingStartedAt`).
   * "assumed": he skipped it and the loading time is `departedAt - defaultLoadingMinutes`.
   */
  startSource: "checklist" | "assumed";
  minutes: number;
};

export type MeasuredTour =
  | {
      ok: true;
      work: MeasuredTourWork;
      /** Planned working time in minutes: the default loading time plus the planned tour duration. */
      plannedMinutes: number | null;
      /** Planned time back at the depot (`departureInstant + totalDurationS`); `null` without a duration. */
      plannedReturnAt: Date | null;
    }
  | {
      ok: false;
      reason: WorkRejectReason;
    };

/** Planned return instant of a tour; `null` without a stored duration or with unusable settings. */
export function plannedReturnAt(
  tour: Pick<WorkTour, "date" | "totalDurationS">,
  settings: Pick<WorkTimeSettings, "departureTime">,
  timeZone: string,
): Date | null {
  if (tour.totalDurationS === null) return null;
  try {
    return new Date(
      departureInstant(tour.date, settings.departureTime, timeZone).getTime() +
        tour.totalDurationS * 1000,
    );
  } catch {
    return null;
  }
}

/**
 * Planned working time of a tour in minutes: the loading time the planning assumes
 * (`defaultLoadingMinutes`) plus the planned driving, service and reload time (`totalDurationS`).
 */
export function plannedTourMinutes(
  tour: Pick<WorkTour, "totalDurationS">,
  settings: WorkTimeSettings,
): number | null {
  if (tour.totalDurationS === null) return null;
  return settings.defaultLoadingMinutes + Math.round(tour.totalDurationS / 60);
}

/**
 * The planned drive back to the depot from the last stop: the planned return instant minus the last
 * stop's ETA minus one service time. For a tour with reload trips this is the final leg, because
 * every reload pause happens before the last stop. `null` when the tour carries no ETA or duration.
 */
export function plannedReturnLegS(
  tour: Pick<WorkTour, "date" | "totalDurationS" | "stops">,
  settings: Pick<WorkTimeSettings, "departureTime" | "serviceMinutesPerStop">,
  timeZone: string,
): number | null {
  const back = plannedReturnAt(tour, settings, timeZone);
  const lastEta = [...tour.stops].reverse().find((stop) => stop.etaAt)?.etaAt;
  if (!back || !lastEta) return null;
  const seconds = Math.round((back.getTime() - lastEta.getTime()) / 1000);
  const leg = seconds - settings.serviceMinutesPerStop * 60;
  return Math.max(leg, 0);
}

/**
 * Measured working time of one tour (NUD-152, D28): from the loading start — `loadingStartedAt`, or
 * `departedAt - defaultLoadingMinutes` when the driver skipped the checklist — to the last completed
 * stop plus the planned drive back to the depot. No GPS. A tour without the timestamps, without
 * stops or without a completed stop cannot be measured; a window that ends on another calendar day
 * (across midnight) is rejected instead of being booked to one day.
 */
export function measureTourWork(
  tour: WorkTour,
  settings: WorkTimeSettings,
  timeZone: string,
): MeasuredTour {
  const assumedStart = tour.departedAt
    ? new Date(tour.departedAt.getTime() - settings.defaultLoadingMinutes * 60_000)
    : null;
  const start = tour.loadingStartedAt ?? assumedStart;
  const startSource: MeasuredTourWork["startSource"] = tour.loadingStartedAt
    ? "checklist"
    : "assumed";
  if (!start) return { ok: false, reason: "no_start" };
  if (tour.stops.length === 0) return { ok: false, reason: "no_stops" };

  const completed = tour.stops
    .map((stop) => stop.completedAt)
    .filter((value): value is Date => value instanceof Date);
  const lastCompleted = completed.reduce<Date | null>(
    (latest, value) => (!latest || value > latest ? value : latest),
    null,
  );
  if (!lastCompleted) return { ok: false, reason: "not_completed" };

  const leg = plannedReturnLegS(tour, settings, timeZone) ?? 0;
  const end = new Date(lastCompleted.getTime() + leg * 1000);
  const minutes = Math.round((end.getTime() - start.getTime()) / 60_000);
  if (minutes <= 0) return { ok: false, reason: "invalid_window" };
  if (localCalendarDate(start, timeZone) !== localCalendarDate(end, timeZone)) {
    return { ok: false, reason: "crosses_midnight" };
  }
  return {
    ok: true,
    work: { start, end, startSource, minutes },
    plannedMinutes: plannedTourMinutes(tour, settings),
    plannedReturnAt: plannedReturnAt(tour, settings, timeZone),
  };
}

/** Percentage of the contracted time a driver used; `null` without contracted time (no schedule). */
export function utilizationPercent(
  actualMinutes: number,
  contractedMinutes: number,
): number | null {
  if (contractedMinutes <= 0) return null;
  return Math.round((actualMinutes / contractedMinutes) * 100);
}

/** What the planning page warns about before the tour is released (NUD-152). */
export type ShiftIssue =
  | { kind: "non_working_day"; weekday: number }
  | {
      kind: "shift_end";
      weekday: number;
      plannedReturnAt: Date;
      shiftEnd: Date;
      overrunMinutes: number;
    };

/**
 * Planning warning for the assigned driver: no shift at all on the tour's weekday, or a planned
 * return after the shift end. A driver without a schedule (no rows) produces no warning — the office
 * did not maintain one, so there is nothing to compare against. Without a stored tour duration the
 * shift end cannot be checked; a non-working day is still reported.
 */
export function shiftIssue(input: {
  tour: Pick<WorkTour, "date" | "totalDurationS">;
  schedule: WorkSchedule | null;
  settings: Pick<WorkTimeSettings, "departureTime">;
  timeZone: string;
}): ShiftIssue | null {
  const { tour, schedule, settings, timeZone } = input;
  if (!schedule || schedule.length === 0) return null;
  const weekday = isoWeekday(tour.date);
  const day = dayForWeekday(schedule, weekday);
  if (!day) return { kind: "non_working_day", weekday };
  const back = plannedReturnAt(tour, settings, timeZone);
  if (!back) return null;
  const shiftEnd = departureInstant(tour.date, minutesToTime(day.endMinutes), timeZone);
  if (back <= shiftEnd) return null;
  return {
    kind: "shift_end",
    weekday,
    plannedReturnAt: back,
    shiftEnd,
    overrunMinutes: Math.round((back.getTime() - shiftEnd.getTime()) / 60_000),
  };
}

/** ISO weekday (1 = Monday) of a DATE value held as UTC midnight. */
export const isoWeekdayOfDate = isoWeekday;

/**
 * The ISO weekdays of the calendar days from `from` to `to` (both "YYYY-MM-DD", inclusive), for the
 * contracted minutes of a report period. Days that are not a valid date are skipped.
 */
export function weekdaysBetween(from: string, to: string): number[] {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
  const weekdays: number[] = [];
  const dayMs = 86_400_000;
  // A report period is bounded by the caller (a month at most), so the loop stays small.
  for (let at = start, guard = 0; at <= end && guard < 400; at += dayMs, guard += 1) {
    weekdays.push(isoWeekday(new Date(at)));
  }
  return weekdays;
}

/** The three report periods of the utilization page (NUD-152). */
export type UtilizationPeriod = "day" | "week" | "month";
export const UTILIZATION_PERIODS: readonly UtilizationPeriod[] = ["day", "week", "month"];

const DAY_MS = 86_400_000;
const isoDate = (instant: number) => new Date(instant).toISOString().slice(0, 10);

/**
 * The calendar days of a report period around `date` ("YYYY-MM-DD"): the day itself, the ISO week
 * Monday to Sunday containing it, or the whole calendar month. An unusable date falls back to
 * `date` for both ends so the report never throws on a bad URL.
 */
export function periodRange(period: UtilizationPeriod, date: string): { from: string; to: string } {
  const start = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(start)) return { from: date, to: date };
  if (period === "week") {
    const monday = start - (isoWeekday(new Date(start)) - 1) * DAY_MS;
    return { from: isoDate(monday), to: isoDate(monday + 6 * DAY_MS) };
  }
  if (period === "month") {
    const day = new Date(start);
    const first = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1);
    const last = Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0);
    return { from: isoDate(first), to: isoDate(last) };
  }
  return { from: date, to: date };
}
