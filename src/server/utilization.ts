import {
  contractMinutes,
  DEFAULT_LOADING_MINUTES,
  measureTourWork,
  periodRange,
  plannedTourMinutes,
  type ScheduleDay,
  summariseSchedule,
  utilizationPercent,
  type UtilizationPeriod,
  weekdaysBetween,
  type WorkRejectReason,
  type WorkTimeSettings,
} from "@/domain/work-time";
import type { PrismaClient } from "@/generated/prisma/client";
import { DEFAULT_TIMEZONE } from "@/lib/format";

import { readSettings } from "./settings";
import { listWorkSchedules } from "./work-schedule";

/**
 * Utilization reports (NUD-152, D28): the measured working time of the tours of a driver compared
 * with the planned time and with the contracted hours of his `WorkSchedule` — per day, week and
 * month. Read-only; the pages that call it (`/admin/drivers`, `/admin/utilization`) have checked the
 * ADMIN role with `requirePageActor`. Nothing here uses GPS (D19): only the timestamps the driver app
 * writes and the planned route of each tour (`domain/work-time.ts`).
 */

type UtilizationDb = Pick<PrismaClient, "tour" | "user" | "settings" | "workSchedule">;

/** Totals of one report period (a day, an ISO week or a month) for one driver. */
export type PeriodTotals = {
  from: string;
  to: string;
  /** Measured working time of the tours of the period, in minutes. */
  actualMinutes: number;
  /** The time the planning assumed for those tours (loading + planned duration), in minutes. */
  plannedMinutes: number;
  /** Contracted minutes from the driver's work schedule over the days of the period. */
  contractMinutes: number;
  /** Actual vs contracted in whole percent; `null` without a schedule. */
  percent: number | null;
  /** Actual vs planned in whole percent; `null` when no measured tour had a planned duration. */
  planPercent: number | null;
  /** Tours of the period that could be measured. */
  tourCount: number;
  /** Tours of the period that could not be measured (missing timestamps, no completed stop, ...). */
  excludedCount: number;
};

/** One tour of the report period: actual vs planned, or the reason it is left out. */
export type TourUtilization = {
  tourId: string;
  /** "YYYY-MM-DD" of `Tour.date`. */
  date: string;
  status: string;
  plannedMinutes: number | null;
  actualMinutes: number | null;
  /** Actual minus planned in minutes (negative = faster than planned). */
  deltaMinutes: number | null;
  planPercent: number | null;
  startSource: "checklist" | "assumed" | null;
  startedAt: string | null;
  endedAt: string | null;
  /** Why the tour is not part of the numbers; `null` when it was measured. */
  reason: WorkRejectReason | null;
};

export type DriverUtilization = {
  driverId: string;
  displayName: string;
  active: boolean;
  /** The stored schedule grouped into "same hours" runs (for the list column). */
  schedule: Array<{ weekdays: number[]; startMinutes: number; endMinutes: number }>;
  hasSchedule: boolean;
  day: PeriodTotals;
  week: PeriodTotals;
  month: PeriodTotals;
  /** The tours of the selected `period` in date order, measured or with the reason they are not. */
  tours: TourUtilization[];
};

export type UtilizationReport = {
  /** The selected period (which tour list the page shows). */
  period: UtilizationPeriod;
  /** All three periods are always computed; the page shows them side by side. */
  day: string;
  from: string;
  to: string;
  timezone: string;
  drivers: DriverUtilization[];
  totals: { actualMinutes: number; plannedMinutes: number; contractMinutes: number };
  /** How many drivers of the report have tours but no work schedule (no percentage possible). */
  withoutSchedule: number;
};

const isoDate = (date: Date) => date.toISOString().slice(0, 10);
const dayMs = 86_400_000;

function emptyTotals(from: string, to: string): PeriodTotals {
  return {
    from,
    to,
    actualMinutes: 0,
    plannedMinutes: 0,
    contractMinutes: 0,
    percent: null,
    planPercent: null,
    tourCount: 0,
    excludedCount: 0,
  };
}

type TourRow = {
  id: string;
  date: Date;
  status: string;
  totalDurationS: number | null;
  loadingStartedAt: Date | null;
  departedAt: Date | null;
  stops: Array<{ etaAt: Date | null; completedAt: Date | null }>;
};

function toTourUtilization(
  tour: TourRow,
  settings: WorkTimeSettings,
  timezone: string,
): TourUtilization {
  const measured = measureTourWork(tour, settings, timezone);
  const planned = plannedTourMinutes(tour, settings);
  if (!measured.ok) {
    return {
      tourId: tour.id,
      date: isoDate(tour.date),
      status: tour.status,
      plannedMinutes: planned,
      actualMinutes: null,
      deltaMinutes: null,
      planPercent: null,
      startSource: null,
      startedAt: null,
      endedAt: null,
      reason: measured.reason,
    };
  }
  return {
    tourId: tour.id,
    date: isoDate(tour.date),
    status: tour.status,
    plannedMinutes: measured.plannedMinutes,
    actualMinutes: measured.work.minutes,
    deltaMinutes:
      measured.plannedMinutes === null ? null : measured.work.minutes - measured.plannedMinutes,
    planPercent: utilizationPercent(measured.work.minutes, measured.plannedMinutes ?? 0),
    startSource: measured.work.startSource,
    startedAt: measured.work.start.toISOString(),
    endedAt: measured.work.end.toISOString(),
    reason: null,
  };
}

function addTour(totals: PeriodTotals, tour: TourUtilization): void {
  if (tour.actualMinutes === null) {
    totals.excludedCount += 1;
    return;
  }
  totals.tourCount += 1;
  totals.actualMinutes += tour.actualMinutes;
  totals.plannedMinutes += tour.plannedMinutes ?? 0;
  totals.percent = utilizationPercent(totals.actualMinutes, totals.contractMinutes);
  totals.planPercent = utilizationPercent(totals.actualMinutes, totals.plannedMinutes);
}

function within(tour: TourUtilization, range: { from: string; to: string }): boolean {
  return tour.date >= range.from && tour.date <= range.to;
}

/** Everything the utilization page needs for one report day (all three periods). */
export async function readUtilization(
  db: UtilizationDb,
  options: {
    /** The report day, "YYYY-MM-DD"; day/week/month are all built around it. */
    date: string;
    /** Which period the tour list shows. */
    period: UtilizationPeriod;
    /** Restrict to these drivers (the driver list only needs its own rows). */
    driverIds?: readonly string[];
  },
): Promise<UtilizationReport> {
  const { date, period } = options;
  const ranges = {
    day: periodRange("day", date),
    week: periodRange("week", date),
    month: periodRange("month", date),
  };
  // One read for all three periods: their union is at most a month plus a week.
  const from = [ranges.day.from, ranges.week.from, ranges.month.from].sort()[0]!;
  const to = [ranges.day.to, ranges.week.to, ranges.month.to].sort().at(-1)!;

  const settings = await readSettings(db);
  const timezone = settings?.timezone ?? DEFAULT_TIMEZONE;
  const workTime: WorkTimeSettings = {
    departureTime: settings?.departureTime ?? "07:00",
    serviceMinutesPerStop: settings?.serviceMinutesPerStop ?? 10,
    defaultLoadingMinutes: settings?.defaultLoadingMinutes ?? DEFAULT_LOADING_MINUTES,
  };

  const driverFilter = options.driverIds?.length
    ? { driverId: { in: [...options.driverIds] } }
    : { driverId: { not: null } };
  const tours = await db.tour.findMany({
    where: {
      date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) },
      ...driverFilter,
    },
    select: {
      id: true,
      date: true,
      driverId: true,
      status: true,
      totalDurationS: true,
      loadingStartedAt: true,
      departedAt: true,
      stops: { orderBy: { sequence: "asc" }, select: { etaAt: true, completedAt: true } },
    },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });

  const tourDriverIds = [
    ...new Set(tours.flatMap((tour) => (tour.driverId ? [tour.driverId] : []))),
  ];
  const wanted = options.driverIds?.length ? [...options.driverIds] : null;
  const drivers = await db.user.findMany({
    where: {
      role: "DRIVER",
      ...(wanted
        ? { id: { in: wanted } }
        : {
            OR: [
              { active: true },
              ...(tourDriverIds.length ? [{ id: { in: tourDriverIds } }] : []),
            ],
          }),
    },
    select: { id: true, displayName: true, active: true },
    orderBy: [{ active: "desc" }, { displayName: "asc" }, { id: "asc" }],
  });

  const schedules = await listWorkSchedules(
    db,
    drivers.map((driver) => driver.id),
  );

  const reports = drivers.map((driver): DriverUtilization => {
    const schedule: ScheduleDay[] = schedules.get(driver.id) ?? [];
    const day = emptyTotals(ranges.day.from, ranges.day.to);
    const week = emptyTotals(ranges.week.from, ranges.week.to);
    const month = emptyTotals(ranges.month.from, ranges.month.to);
    for (const totals of [day, week, month]) {
      totals.contractMinutes = contractMinutes(schedule, weekdaysBetween(totals.from, totals.to));
    }
    const own = tours.filter((tour) => tour.driverId === driver.id);
    const rows = own.map((tour) => toTourUtilization(tour, workTime, timezone));
    for (const row of rows) {
      if (within(row, day)) addTour(day, row);
      if (within(row, week)) addTour(week, row);
      if (within(row, month)) addTour(month, row);
    }
    // `addTour` may run before the contract is known for a period; percentages are taken once more.
    for (const totals of [day, week, month]) {
      totals.percent = utilizationPercent(totals.actualMinutes, totals.contractMinutes);
    }
    return {
      driverId: driver.id,
      displayName: driver.displayName,
      active: driver.active,
      schedule: summariseSchedule(schedule),
      hasSchedule: schedule.some((entry) => entry.active),
      day,
      week,
      month,
      tours: rows.filter((row) => within(row, ranges[period])),
    };
  });

  const selected = ranges[period];
  const totals = reports.reduce(
    (sum, report) => {
      const period_ = report[period];
      return {
        actualMinutes: sum.actualMinutes + period_.actualMinutes,
        plannedMinutes: sum.plannedMinutes + period_.plannedMinutes,
        contractMinutes: sum.contractMinutes + period_.contractMinutes,
      };
    },
    { actualMinutes: 0, plannedMinutes: 0, contractMinutes: 0 },
  );

  return {
    period,
    day: date,
    from: selected.from,
    to: selected.to,
    timezone,
    drivers: reports,
    totals,
    withoutSchedule: reports.filter(
      (report) => !report.hasSchedule && report[period].actualMinutes > 0,
    ).length,
  };
}

/**
 * The utilization of the ISO week around `date` per driver — the column of the driver list
 * (NUD-152). Same computation as the report, restricted to the requested drivers.
 */
export async function weekUtilization(
  db: UtilizationDb,
  date: string,
  driverIds?: readonly string[],
): Promise<Map<string, PeriodTotals>> {
  const report = await readUtilization(db, { date, period: "week", driverIds });
  return new Map(report.drivers.map((driver) => [driver.driverId, driver.week]));
}

/** "Today" as the factory's calendar day ("YYYY-MM-DD") — the default report day. */
export function factoryToday(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "01";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Parses a "YYYY-MM-DD" report day; falls back to `fallback` for anything else. */
export function parseReportDay(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return fallback;
  const instant = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(instant)) return fallback;
  // Reject days that roll over (2026-02-30).
  return isoDate(new Date(instant)) === value ? value : fallback;
}

/** Parses the `period` search parameter; anything unknown falls back to the week. */
export function parsePeriod(value: unknown): UtilizationPeriod {
  return value === "day" || value === "month" ? value : "week";
}

/** Shifts a report day by `days` days (`YYYY-MM-DD` in, `YYYY-MM-DD` out). */
export function shiftDay(date: string, days: number): string {
  const instant = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(instant)) return date;
  return isoDate(new Date(instant + days * dayMs));
}
