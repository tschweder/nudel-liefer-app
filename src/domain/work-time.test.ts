import { describe, expect, it } from "vitest";

import {
  contractMinutes,
  dayForWeekday,
  dayMinutes,
  isoWeekdayOfDate,
  localCalendarDate,
  measureTourWork,
  minutesToTime,
  periodRange,
  plannedReturnAt,
  plannedReturnLegS,
  plannedTourMinutes,
  type ScheduleDay,
  shiftIssue,
  summariseSchedule,
  timeToMinutes,
  utilizationPercent,
  weekdaysBetween,
  weekMinutes,
} from "./work-time";

const TZ = "Europe/Vienna";
/** Monday 19 October 2026 (CEST, UTC+2): 07:00 local is 05:00Z. */
const MONDAY = new Date("2026-10-19T00:00:00Z");
const SATURDAY = new Date("2026-10-24T00:00:00Z");
const SETTINGS = { departureTime: "07:00", serviceMinutesPerStop: 10, defaultLoadingMinutes: 20 };

const day = (weekday: number, start: number, end: number, active = true): ScheduleDay => ({
  weekday,
  startMinutes: start,
  endMinutes: end,
  active,
});

/** Monday to Friday 06:00–14:00. */
const WEEK: ScheduleDay[] = [1, 2, 3, 4, 5].map((weekday) => day(weekday, 6 * 60, 14 * 60));

describe("time helpers", () => {
  it("converts HH:MM to minutes and back", () => {
    expect(timeToMinutes("06:00")).toBe(360);
    expect(timeToMinutes("14:00")).toBe(840);
    expect(timeToMinutes("00:00")).toBe(0);
    expect(timeToMinutes("23:59")).toBe(1439);
    expect(minutesToTime(360)).toBe("06:00");
    expect(minutesToTime(1439)).toBe("23:59");
  });

  it("rejects anything that is not HH:MM inside the day", () => {
    for (const value of ["6:00", "24:00", "14:60", "14:00:00", "", "abc"]) {
      expect(timeToMinutes(value), value).toBeNull();
    }
  });

  it("clamps minutesToTime into the day", () => {
    expect(minutesToTime(-10)).toBe("00:00");
    expect(minutesToTime(1440)).toBe("23:59");
  });

  it("reads the ISO weekday of a DATE value", () => {
    expect(isoWeekdayOfDate(MONDAY)).toBe(1);
    expect(isoWeekdayOfDate(SATURDAY)).toBe(6);
  });

  it("reads the local calendar day of an instant", () => {
    expect(localCalendarDate(new Date("2026-10-19T04:30:00Z"), TZ)).toBe("2026-10-19");
    // 22:30Z is already the next day in Vienna (UTC+2 in October).
    expect(localCalendarDate(new Date("2026-10-19T22:30:00Z"), TZ)).toBe("2026-10-20");
  });
});

describe("schedule hours", () => {
  it("counts the minutes of one day, ignoring non-working and invalid rows", () => {
    expect(dayMinutes(day(1, 360, 840))).toBe(480);
    expect(dayMinutes(day(1, 360, 840, false))).toBe(0);
    expect(dayMinutes(day(1, 840, 360))).toBe(0);
    expect(dayMinutes(day(0, 360, 840))).toBe(0);
    expect(dayMinutes(day(1, 360, 1440))).toBe(0);
    expect(dayMinutes(null)).toBe(0);
  });

  it("finds the active row of a weekday only", () => {
    expect(dayForWeekday(WEEK, 1)?.startMinutes).toBe(360);
    expect(dayForWeekday(WEEK, 6)).toBeNull();
    expect(dayForWeekday([day(6, 360, 840, false)], 6)).toBeNull();
  });

  it("adds up a week and an explicit list of weekdays", () => {
    expect(weekMinutes(WEEK)).toBe(2400);
    expect(contractMinutes(WEEK, [1, 2, 3, 4, 5, 6, 7])).toBe(2400);
    expect(contractMinutes(WEEK, [6, 7])).toBe(0);
    expect(contractMinutes([], [1, 2, 3, 4, 5])).toBe(0);
  });

  it("groups consecutive weekdays with the same hours into one run", () => {
    expect(summariseSchedule(WEEK)).toEqual([
      { weekdays: [1, 2, 3, 4, 5], startMinutes: 360, endMinutes: 840 },
    ]);
    const split = [day(1, 360, 840), day(2, 360, 840), day(4, 480, 960), day(5, 480, 960)];
    expect(summariseSchedule(split)).toEqual([
      { weekdays: [1, 2], startMinutes: 360, endMinutes: 840 },
      { weekdays: [4, 5], startMinutes: 480, endMinutes: 960 },
    ]);
    expect(summariseSchedule([])).toEqual([]);
  });

  it("lists the ISO weekdays of a date range", () => {
    expect(weekdaysBetween("2026-10-19", "2026-10-25")).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(weekdaysBetween("2026-10-19", "2026-10-19")).toEqual([1]);
    expect(weekdaysBetween("2026-10-25", "2026-10-19")).toEqual([]);
  });

  it("covers the day, the ISO week and the month of a report period", () => {
    expect(periodRange("day", "2026-10-21")).toEqual({ from: "2026-10-21", to: "2026-10-21" });
    expect(periodRange("week", "2026-10-21")).toEqual({ from: "2026-10-19", to: "2026-10-25" });
    // Sunday belongs to the week that started on the Monday before it.
    expect(periodRange("week", "2026-10-25")).toEqual({ from: "2026-10-19", to: "2026-10-25" });
    expect(periodRange("month", "2026-10-21")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(periodRange("month", "2026-02-10")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(periodRange("week", "not-a-date")).toEqual({ from: "not-a-date", to: "not-a-date" });
  });
});

describe("planned time of a tour", () => {
  it("is the default loading time plus the planned duration", () => {
    expect(plannedTourMinutes({ totalDurationS: 21_600 }, SETTINGS)).toBe(20 + 360);
    expect(plannedTourMinutes({ totalDurationS: null }, SETTINGS)).toBeNull();
  });

  it("returns the planned instant back at the depot", () => {
    expect(
      plannedReturnAt({ date: MONDAY, totalDurationS: 21_600 }, SETTINGS, TZ)?.toISOString(),
    ).toBe("2026-10-19T11:00:00.000Z");
    expect(plannedReturnAt({ date: MONDAY, totalDurationS: null }, SETTINGS, TZ)).toBeNull();
    expect(
      plannedReturnAt({ date: MONDAY, totalDurationS: 21_600 }, { departureTime: "oops" }, TZ),
    ).toBeNull();
  });

  it("derives the planned drive back from the last ETA and one service time", () => {
    // Planned departure 07:00 local (05:00Z), 6 h tour -> back at 13:00 local (11:00Z); last stop
    // ETA 12:00 local (10:00Z): 1 h left, minus 10 min service = 50 min drive.
    const stops = [
      { etaAt: new Date("2026-10-19T06:00:00Z"), completedAt: null },
      { etaAt: new Date("2026-10-19T10:00:00Z"), completedAt: null },
    ];
    expect(plannedReturnLegS({ date: MONDAY, totalDurationS: 21_600, stops }, SETTINGS, TZ)).toBe(
      50 * 60,
    );
    expect(
      plannedReturnLegS({ date: MONDAY, totalDurationS: null, stops }, SETTINGS, TZ),
    ).toBeNull();
  });
});

describe("measured working time", () => {
  const stops = [
    { etaAt: new Date("2026-10-19T06:00:00Z"), completedAt: new Date("2026-10-19T06:12:00Z") },
    { etaAt: new Date("2026-10-19T10:00:00Z"), completedAt: new Date("2026-10-19T10:20:00Z") },
  ];

  it("runs from the loading start to the last completed stop plus the drive back", () => {
    const result = measureTourWork(
      {
        date: MONDAY,
        loadingStartedAt: new Date("2026-10-19T04:40:00Z"),
        departedAt: new Date("2026-10-19T05:00:00Z"),
        totalDurationS: 21_600,
        stops,
      },
      SETTINGS,
      TZ,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.work.startSource).toBe("checklist");
    expect(result.work.start.toISOString()).toBe("2026-10-19T04:40:00.000Z");
    // Last stop completed 10:20Z plus the 50 min drive back.
    expect(result.work.end.toISOString()).toBe("2026-10-19T11:10:00.000Z");
    expect(result.work.minutes).toBe(390);
    expect(result.plannedMinutes).toBe(380);
    expect(result.plannedReturnAt?.toISOString()).toBe("2026-10-19T11:00:00.000Z");
  });

  it("assumes the default loading time when the checklist was skipped", () => {
    const result = measureTourWork(
      {
        date: MONDAY,
        loadingStartedAt: null,
        departedAt: new Date("2026-10-19T05:00:00Z"),
        totalDurationS: 21_600,
        stops,
      },
      SETTINGS,
      TZ,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.work.startSource).toBe("assumed");
    expect(result.work.start.toISOString()).toBe("2026-10-19T04:40:00.000Z");
    expect(result.work.minutes).toBe(390);
  });

  it("measures a tour without a completed stop as not measurable", () => {
    const result = measureTourWork(
      {
        date: MONDAY,
        loadingStartedAt: new Date("2026-10-19T04:40:00Z"),
        departedAt: null,
        totalDurationS: 21_600,
        stops: stops.map((stop) => ({ ...stop, completedAt: null })),
      },
      SETTINGS,
      TZ,
    );
    expect(result).toEqual({ ok: false, reason: "not_completed" });
  });

  it("rejects a tour without timestamps and without stops", () => {
    expect(
      measureTourWork(
        { date: MONDAY, loadingStartedAt: null, departedAt: null, totalDurationS: 21_600, stops },
        SETTINGS,
        TZ,
      ),
    ).toEqual({ ok: false, reason: "no_start" });
    expect(
      measureTourWork(
        {
          date: MONDAY,
          loadingStartedAt: new Date("2026-10-19T04:40:00Z"),
          departedAt: null,
          totalDurationS: 21_600,
          stops: [],
        },
        SETTINGS,
        TZ,
      ),
    ).toEqual({ ok: false, reason: "no_stops" });
  });

  it("rejects a window that runs across midnight instead of booking it to one day", () => {
    // Planned departure 07:00 local, 16 h tour -> back at 23:00 local; last stop ETA 22:00 local.
    const result = measureTourWork(
      {
        date: MONDAY,
        loadingStartedAt: new Date("2026-10-19T04:40:00Z"),
        departedAt: new Date("2026-10-19T05:00:00Z"),
        totalDurationS: 16 * 3600,
        stops: [
          {
            etaAt: new Date("2026-10-19T20:00:00Z"),
            completedAt: new Date("2026-10-19T21:10:00Z"),
          },
        ],
      },
      SETTINGS,
      TZ,
    );
    expect(result).toEqual({ ok: false, reason: "crosses_midnight" });
  });

  it("rejects an end before the start", () => {
    const result = measureTourWork(
      {
        date: MONDAY,
        loadingStartedAt: new Date("2026-10-19T12:00:00Z"),
        departedAt: null,
        totalDurationS: 21_600,
        stops,
      },
      SETTINGS,
      TZ,
    );
    expect(result).toEqual({ ok: false, reason: "invalid_window" });
  });
});

describe("utilization percentage", () => {
  it("is the used share of the contracted time", () => {
    expect(utilizationPercent(240, 480)).toBe(50);
    expect(utilizationPercent(500, 480)).toBe(104);
    expect(utilizationPercent(0, 480)).toBe(0);
  });

  it("is null without contracted time (no schedule)", () => {
    expect(utilizationPercent(240, 0)).toBeNull();
  });
});

describe("planning warning for a tour", () => {
  const base = { date: MONDAY, totalDurationS: 21_600 };

  it("warns when the planned return is after the shift end", () => {
    const issue = shiftIssue({ tour: base, schedule: WEEK, settings: SETTINGS, timeZone: TZ });
    // Shift 06:00-14:00 local; planned return 13:00 local -> no warning.
    expect(issue).toBeNull();
    const late = shiftIssue({
      tour: { date: MONDAY, totalDurationS: 8 * 3600 },
      schedule: WEEK,
      settings: SETTINGS,
      timeZone: TZ,
    });
    expect(late?.kind).toBe("shift_end");
    if (late?.kind !== "shift_end") return;
    // 07:00 + 8 h = 15:00 local, shift ends at 14:00 -> 60 min over.
    expect(late.overrunMinutes).toBe(60);
    expect(late.shiftEnd.toISOString()).toBe("2026-10-19T12:00:00.000Z");
  });

  it("warns when the tour is planned on a non-working day", () => {
    const issue = shiftIssue({
      tour: { date: SATURDAY, totalDurationS: 21_600 },
      schedule: WEEK,
      settings: SETTINGS,
      timeZone: TZ,
    });
    expect(issue).toEqual({ kind: "non_working_day", weekday: 6 });
  });

  it("stays silent without a schedule, without a duration and when the driver works longer", () => {
    expect(shiftIssue({ tour: base, schedule: [], settings: SETTINGS, timeZone: TZ })).toBeNull();
    expect(shiftIssue({ tour: base, schedule: null, settings: SETTINGS, timeZone: TZ })).toBeNull();
    expect(
      shiftIssue({
        tour: { date: MONDAY, totalDurationS: null },
        schedule: WEEK,
        settings: SETTINGS,
        timeZone: TZ,
      }),
    ).toBeNull();
    const longShift = [day(1, 360, 21 * 60)];
    expect(
      shiftIssue({ tour: base, schedule: longShift, settings: SETTINGS, timeZone: TZ }),
    ).toBeNull();
  });

  it("still reports a non-working day without a stored duration", () => {
    expect(
      shiftIssue({
        tour: { date: SATURDAY, totalDurationS: null },
        schedule: WEEK,
        settings: SETTINGS,
        timeZone: TZ,
      }),
    ).toEqual({ kind: "non_working_day", weekday: 6 });
  });
});
