import { describe, expect, it } from "vitest";

import {
  generationHorizon,
  inSeason,
  occursOn,
  recurringOrderInputSchema,
  type RecurringSchedule,
  ruleState,
  scheduleDates,
} from "./recurring-order";

const d = (v: string) => new Date(`${v}T00:00:00Z`);
const iso = (days: Date[]) => days.map((x) => x.toISOString().slice(0, 10));

function rule(over: Partial<RecurringSchedule> = {}): RecurringSchedule {
  return {
    weekdays: [1],
    everyNWeeks: 1,
    anchorDate: d("2026-11-02"), // a Monday
    seasonFrom: null,
    seasonTo: null,
    exceptions: [],
    ...over,
  };
}

describe("scheduleDates", () => {
  it("every Monday and Thursday", () => {
    const days = scheduleDates(rule({ weekdays: [1, 4] }), d("2026-11-02"), d("2026-11-16"));
    expect(iso(days)).toEqual([
      "2026-11-02",
      "2026-11-05",
      "2026-11-09",
      "2026-11-12",
      "2026-11-16",
    ]);
  });

  it("never before the anchor date", () => {
    const days = scheduleDates(
      rule({ weekdays: [1, 4], anchorDate: d("2026-11-05") }),
      d("2026-11-02"),
      d("2026-11-10"),
    );
    expect(iso(days)).toEqual(["2026-11-05", "2026-11-09"]);
  });

  it("every second week counts from the week of the anchor, not from the anchor day", () => {
    // Anchor Wednesday 2026-11-04; the rule delivers Mon + Fri. Week 0 = 2026-11-02..08.
    const r = rule({ weekdays: [1, 5], everyNWeeks: 2, anchorDate: d("2026-11-04") });
    expect(iso(scheduleDates(r, d("2026-11-02"), d("2026-12-06")))).toEqual([
      "2026-11-06", // Friday of week 0 (the Monday lies before the anchor)
      "2026-11-16",
      "2026-11-20",
      "2026-11-30",
      "2026-12-04",
    ]);
  });

  it("every third week", () => {
    const r = rule({ everyNWeeks: 3 });
    expect(iso(scheduleDates(r, d("2026-11-02"), d("2027-01-31")))).toEqual([
      "2026-11-02",
      "2026-11-23",
      "2026-12-14",
      "2027-01-04",
      "2027-01-25",
    ]);
  });

  it("week counting survives the year boundary", () => {
    const r = rule({ everyNWeeks: 2, anchorDate: d("2026-12-21") });
    expect(iso(scheduleDates(r, d("2026-12-21"), d("2027-02-01")))).toEqual([
      "2026-12-21",
      "2027-01-04",
      "2027-01-18",
      "2027-02-01",
    ]);
  });

  it("season September to May wraps over the year boundary and pauses in summer", () => {
    const r = rule({ seasonFrom: "09-01", seasonTo: "05-31", anchorDate: d("2026-01-05") });
    expect(occursOn(r, d("2026-09-07"))).toBe(true); // Monday in September
    expect(occursOn(r, d("2026-12-28"))).toBe(true);
    expect(occursOn(r, d("2027-01-04"))).toBe(true);
    expect(occursOn(r, d("2027-05-31"))).toBe(true); // last day, inclusive
    expect(occursOn(r, d("2027-06-07"))).toBe(false);
    expect(occursOn(r, d("2027-07-05"))).toBe(false);
    expect(occursOn(r, d("2027-08-30"))).toBe(false);
    expect(occursOn(r, d("2027-08-31"))).toBe(false);
    expect(occursOn(r, d("2027-09-06"))).toBe(true);
  });

  it("season inside one year", () => {
    expect(inSeason(d("2026-06-15"), "06-01", "08-31")).toBe(true);
    expect(inSeason(d("2026-05-31"), "06-01", "08-31")).toBe(false);
    expect(inSeason(d("2026-09-01"), "06-01", "08-31")).toBe(false);
    expect(inSeason(d("2026-09-01"), null, null)).toBe(true);
  });

  it("exceptions skip single days only", () => {
    const r = rule({ exceptions: [d("2026-11-09")] });
    expect(iso(scheduleDates(r, d("2026-11-02"), d("2026-11-16")))).toEqual([
      "2026-11-02",
      "2026-11-16",
    ]);
  });

  it("combined: every second week, season, exception", () => {
    const r = rule({
      weekdays: [2],
      everyNWeeks: 2,
      anchorDate: d("2026-09-01"),
      seasonFrom: "09-01",
      seasonTo: "05-31",
      exceptions: [d("2026-09-15")],
    });
    expect(iso(scheduleDates(r, d("2026-09-01"), d("2026-10-31")))).toEqual([
      "2026-09-01",
      "2026-09-29",
      "2026-10-13",
      "2026-10-27",
    ]);
  });
});

describe("generationHorizon", () => {
  it("is today plus the lead days, clamped", () => {
    expect(generationHorizon(d("2026-11-02"), 14).toISOString().slice(0, 10)).toBe("2026-11-16");
    expect(generationHorizon(d("2026-11-02"), 0).toISOString().slice(0, 10)).toBe("2026-11-03");
    expect(generationHorizon(d("2026-11-02"), 999).toISOString().slice(0, 10)).toBe("2027-01-01");
  });
});

describe("recurringOrderInputSchema", () => {
  const base = {
    customerId: "c1",
    weekdays: [4, 1, 1],
    anchorDate: "2026-11-02",
    lines: [
      { productId: "p1", quantity: 2 },
      { productId: "p1", quantity: 3 },
    ],
  };

  it("normalises weekdays, defaults, merges lines", () => {
    const v = recurringOrderInputSchema.parse(base);
    expect(v.weekdays).toEqual([1, 4]);
    expect(v.everyNWeeks).toBe(1);
    expect(v.exceptions).toEqual([]);
    expect(v.lines).toEqual([{ productId: "p1", quantity: 5 }]);
  });

  it("rejects bad input", () => {
    const bad = (over: object) => recurringOrderInputSchema.safeParse({ ...base, ...over }).success;
    expect(bad({})).toBe(true);
    expect(bad({ weekdays: [] })).toBe(false);
    expect(bad({ weekdays: [8] })).toBe(false);
    expect(bad({ everyNWeeks: 0 })).toBe(false);
    expect(bad({ everyNWeeks: 53 })).toBe(false);
    expect(bad({ anchorDate: "2026-02-30" })).toBe(false);
    expect(bad({ seasonFrom: "09-01" })).toBe(false); // both or none
    expect(bad({ seasonFrom: "13-01", seasonTo: "05-31" })).toBe(false);
    expect(bad({ seasonFrom: "09-01", seasonTo: "05-31" })).toBe(true);
    expect(bad({ lines: [] })).toBe(false);
    expect(bad({ lines: [{ productId: "p1", quantity: 1.5 }] })).toBe(false);
    expect(bad({ lines: [{ productId: "p1", quantity: 0 }] })).toBe(false);
    expect(bad({ exceptions: ["nope"] })).toBe(false);
  });
});

describe("ruleState", () => {
  it("distinguishes the office pause from the customer pause", () => {
    expect(ruleState({ active: true, pausedByCustomer: false })).toBe("active");
    expect(ruleState({ active: false, pausedByCustomer: false })).toBe("paused");
    expect(ruleState({ active: false, pausedByCustomer: true })).toBe("customer_inactive");
  });
});
