import { describe, expect, it } from "vitest";

import {
  generationHorizon,
  inSeason,
  itemsForWeekday,
  monthlyRuleMatches,
  nextScheduleDates,
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

describe("monthly patterns (NUD-171)", () => {
  it("dayOfMonth delivers on that day of every month", () => {
    const r = rule({ weekdays: [], monthlyRules: [{ kind: "dayOfMonth", day: 15 }] });
    expect(iso(scheduleDates(r, d("2026-11-01"), d("2026-12-31")))).toEqual([
      "2026-11-15",
      "2026-12-15",
    ]);
  });

  it("dayOfMonth does not clamp: day 31 is skipped in months with fewer days", () => {
    const r = rule({ weekdays: [], monthlyRules: [{ kind: "dayOfMonth", day: 31 }] });
    expect(iso(scheduleDates(r, d("2026-11-01"), d("2027-02-28")))).toEqual([
      "2026-12-31",
      "2027-01-31",
    ]);
  });

  it("nthWeekday: the first Monday of every month", () => {
    const r = rule({
      weekdays: [],
      monthlyRules: [{ kind: "nthWeekday", nth: 1, weekday: 1 }],
    });
    expect(iso(scheduleDates(r, d("2026-11-01"), d("2027-01-31")))).toEqual([
      "2026-11-02",
      "2026-12-07",
      "2027-01-04",
    ]);
  });

  it("nthWeekday: the last Friday of every month", () => {
    const r = rule({
      weekdays: [],
      monthlyRules: [{ kind: "nthWeekday", nth: -1, weekday: 5 }],
    });
    expect(iso(scheduleDates(r, d("2026-11-01"), d("2027-01-31")))).toEqual([
      "2026-11-27",
      "2026-12-25",
      "2027-01-29",
    ]);
  });

  it("nthWeekday 4 is the fourth one, not the last (a fifth one is ignored)", () => {
    // November 2026 has five Mondays (2, 9, 16, 23, 30); February 2027 has four (1, 8, 15, 22).
    const r = rule({ weekdays: [], monthlyRules: [{ kind: "nthWeekday", nth: 4, weekday: 1 }] });
    expect(iso(scheduleDates(r, d("2026-11-01"), d("2027-02-28")))).toEqual([
      "2026-11-23",
      "2026-12-28",
      "2027-01-25",
      "2027-02-22",
    ]);
  });

  it("matches a single day exactly", () => {
    const nth = { kind: "nthWeekday", nth: -1, weekday: 5 } as const;
    expect(monthlyRuleMatches(nth, d("2026-11-27"))).toBe(true);
    expect(monthlyRuleMatches(nth, d("2026-11-20"))).toBe(false);
    expect(monthlyRuleMatches({ kind: "dayOfMonth", day: 31 }, d("2026-11-30"))).toBe(false);
  });

  it("is the union of the weekly and the monthly pattern, ascending and without duplicates", () => {
    // Delivers every Monday AND on the 5th of every month; 2026-12-05 is a Saturday, 2027-01-05 a
    // Tuesday. 2026-12-07 (a Monday) and 2026-12-05 (the 5th) are two different days.
    const r = rule({ weekdays: [1], monthlyRules: [{ kind: "dayOfMonth", day: 5 }] });
    expect(iso(scheduleDates(r, d("2026-11-30"), d("2027-01-11")))).toEqual([
      "2026-11-30",
      "2026-12-05",
      "2026-12-07",
      "2026-12-14",
      "2026-12-21",
      "2026-12-28",
      "2027-01-04",
      "2027-01-05",
      "2027-01-11",
    ]);
  });

  it("a monthly-only rule needs no weekday and still honours the anchor date", () => {
    const r = rule({
      weekdays: [],
      anchorDate: d("2026-12-01"),
      monthlyRules: [{ kind: "dayOfMonth", day: 15 }],
    });
    expect(iso(scheduleDates(r, d("2026-11-01"), d("2026-12-31")))).toEqual(["2026-12-15"]);
  });

  it("season, single-day exceptions and the skipped range gate the monthly pattern too", () => {
    const r = rule({
      weekdays: [],
      monthlyRules: [{ kind: "dayOfMonth", day: 15 }],
      seasonFrom: "01-01",
      seasonTo: "12-14",
      exceptions: [d("2027-01-15")],
      skipFrom: d("2027-02-01"),
      skipTo: d("2027-03-31"),
    });
    expect(iso(scheduleDates(r, d("2026-11-01"), d("2027-04-30")))).toEqual([
      "2026-11-15",
      "2027-04-15",
    ]);
  });
});

describe("end conditions (NUD-171)", () => {
  it("endsOn is the last delivery day, inclusive", () => {
    const r = rule({ endsOn: d("2026-11-16") });
    expect(iso(scheduleDates(r, d("2026-11-02"), d("2026-12-31")))).toEqual([
      "2026-11-02",
      "2026-11-09",
      "2026-11-16",
    ]);
  });

  it("endsOn also stops the preview", () => {
    const r = rule({ endsOn: d("2026-11-09") });
    expect(iso(nextScheduleDates(r, d("2026-11-02"), 5))).toEqual(["2026-11-02", "2026-11-09"]);
    expect(iso(nextScheduleDates(rule(), d("2026-11-02"), 3))).toEqual([
      "2026-11-02",
      "2026-11-09",
      "2026-11-16",
    ]);
  });

  it("the skipped range is inclusive on both ends", () => {
    const r = rule({ skipFrom: d("2026-11-09"), skipTo: d("2026-11-16") });
    expect(iso(scheduleDates(r, d("2026-11-02"), d("2026-11-23")))).toEqual([
      "2026-11-02",
      "2026-11-23",
    ]);
  });

  it("a half-open skipped range skips nothing (both or none)", () => {
    const r = rule({ skipFrom: d("2026-11-09"), skipTo: null });
    expect(iso(scheduleDates(r, d("2026-11-02"), d("2026-11-16")))).toEqual([
      "2026-11-02",
      "2026-11-09",
      "2026-11-16",
    ]);
  });
});

describe("itemsForWeekday (NUD-171)", () => {
  const base = [{ productId: "pack", quantity: 2 }];
  const dayItems = [
    { weekday: 4, productId: "crate", quantity: 1 },
    { weekday: 4, productId: "pack", quantity: 5 },
  ];

  it("uses the weekday's own list when it has rows", () => {
    expect(itemsForWeekday(rule(), 4, base, dayItems)).toEqual([
      { productId: "crate", quantity: 1 },
      { productId: "pack", quantity: 5 },
    ]);
  });

  it("falls back to the base list for every other weekday", () => {
    expect(itemsForWeekday(rule(), 1, base, dayItems)).toEqual([
      { productId: "pack", quantity: 2 },
    ]);
    expect(itemsForWeekday(rule({ weekdays: [1], monthlyRules: [] }), 7, base, [])).toEqual([
      { productId: "pack", quantity: 2 },
    ]);
  });

  it("does not mutate its input and returns fresh objects", () => {
    const out = itemsForWeekday(rule(), 1, base, []);
    out[0]!.quantity = 99;
    expect(base).toEqual([{ productId: "pack", quantity: 2 }]);
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

describe("recurringOrderInputSchema — NUD-171 fields", () => {
  const base = {
    customerId: "c1",
    weekdays: [1],
    anchorDate: "2026-11-02",
    lines: [{ productId: "p1", quantity: 1 }],
  };
  const parse = (over: object) => recurringOrderInputSchema.safeParse({ ...base, ...over });

  it("accepts a monthly-only rule and rejects one without any pattern", () => {
    expect(parse({ weekdays: [], monthlyRules: [{ kind: "dayOfMonth", day: 1 }] }).success).toBe(
      true,
    );
    expect(parse({ weekdays: [], monthlyRules: [] }).success).toBe(false);
    expect(parse({}).success).toBe(true);
  });

  it("defaults monthlyRules to [] and de-duplicates while keeping the order", () => {
    expect(recurringOrderInputSchema.parse(base).monthlyRules).toEqual([]);
    const v = recurringOrderInputSchema.parse({
      ...base,
      monthlyRules: [
        { kind: "nthWeekday", nth: -1, weekday: 5 },
        { kind: "nthWeekday", nth: -1, weekday: 5 },
        { kind: "dayOfMonth", day: 1 },
      ],
    });
    expect(v.monthlyRules).toEqual([
      { kind: "nthWeekday", nth: -1, weekday: 5 },
      { kind: "dayOfMonth", day: 1 },
    ]);
  });

  it("rejects unknown kinds, extra keys, bad numbers and more than ten rules", () => {
    expect(parse({ monthlyRules: [{ kind: "weekly", day: 1 }] }).success).toBe(false);
    expect(parse({ monthlyRules: [{ kind: "dayOfMonth", day: 1, extra: true }] }).success).toBe(
      false,
    );
    expect(parse({ monthlyRules: [{ kind: "dayOfMonth", day: 0 }] }).success).toBe(false);
    expect(parse({ monthlyRules: [{ kind: "dayOfMonth", day: 32 }] }).success).toBe(false);
    expect(parse({ monthlyRules: [{ kind: "nthWeekday", nth: 5, weekday: 1 }] }).success).toBe(
      false,
    );
    expect(parse({ monthlyRules: [{ kind: "nthWeekday", nth: 1, weekday: 8 }] }).success).toBe(
      false,
    );
    const eleven = Array.from({ length: 11 }, (_, i) => ({ kind: "dayOfMonth", day: i + 1 }));
    expect(parse({ monthlyRules: eleven }).success).toBe(false);
  });

  it("window times are both or none and start before end", () => {
    expect(parse({ windowFromTime: "08:00", windowToTime: "12:00" }).success).toBe(true);
    expect(parse({ windowFromTime: "08:00", windowToTime: null }).success).toBe(false);
    expect(parse({ windowFromTime: "12:00", windowToTime: "08:00" }).success).toBe(false);
    expect(parse({ windowFromTime: "08:00", windowToTime: "08:00" }).success).toBe(false);
    expect(parse({ windowFromTime: "8:00", windowToTime: "12:00" }).success).toBe(false);
    expect(parse({ windowFromTime: "24:00", windowToTime: "23:59" }).success).toBe(false);
    const v = recurringOrderInputSchema.parse(base);
    expect([v.windowFromTime, v.windowToTime]).toEqual([null, null]);
  });

  it("the skipped range is both or none and ordered", () => {
    expect(parse({ skipFrom: "2026-12-24", skipTo: "2027-01-06" }).success).toBe(true);
    expect(parse({ skipFrom: "2026-12-24" }).success).toBe(false);
    expect(parse({ skipFrom: "2027-01-06", skipTo: "2026-12-24" }).success).toBe(false);
  });

  it("endsOn lies on or after the anchor date; maxDeliveries is 1..1000", () => {
    expect(parse({ endsOn: "2026-11-02" }).success).toBe(true);
    expect(parse({ endsOn: "2026-11-01" }).success).toBe(false);
    expect(parse({ endsOn: "2026-02-30" }).success).toBe(false);
    expect(parse({ maxDeliveries: 1 }).success).toBe(true);
    expect(parse({ maxDeliveries: 0 }).success).toBe(false);
    expect(parse({ maxDeliveries: 1001 }).success).toBe(false);
    expect(parse({ maxDeliveries: 2.5 }).success).toBe(false);
  });

  it("merges day items per weekday and product, weekdays ascending", () => {
    const v = recurringOrderInputSchema.parse({
      ...base,
      dayItems: [
        { weekday: 4, productId: "p1", quantity: 2 },
        { weekday: 1, productId: "p2", quantity: 1 },
        { weekday: 4, productId: "p1", quantity: 3 },
      ],
    });
    expect(v.dayItems).toEqual([
      { weekday: 1, productId: "p2", quantity: 1 },
      { weekday: 4, productId: "p1", quantity: 5 },
    ]);
  });

  it("rejects day items with a weekday outside 1..7 or a bad quantity", () => {
    expect(parse({ dayItems: [{ weekday: 0, productId: "p1", quantity: 1 }] }).success).toBe(false);
    expect(parse({ dayItems: [{ weekday: 8, productId: "p1", quantity: 1 }] }).success).toBe(false);
    expect(parse({ dayItems: [{ weekday: 1, productId: "p1", quantity: 0 }] }).success).toBe(false);
    expect(parse({ dayItems: [{ weekday: 1, productId: "p1", quantity: 1.5 }] }).success).toBe(
      false,
    );
    expect(parse({ dayItems: [{ weekday: 1, productId: "", quantity: 1 }] }).success).toBe(false);
    const overflow = [
      { weekday: 1, productId: "p1", quantity: 99_998 },
      { weekday: 1, productId: "p1", quantity: 2 },
    ];
    expect(parse({ dayItems: overflow }).success).toBe(false);
  });
});

describe("ruleState", () => {
  it("distinguishes the office pause from the customer pause", () => {
    expect(ruleState({ active: true, pausedByCustomer: false })).toBe("active");
    expect(ruleState({ active: false, pausedByCustomer: false })).toBe("paused");
    expect(ruleState({ active: false, pausedByCustomer: true })).toBe("customer_inactive");
  });
});
