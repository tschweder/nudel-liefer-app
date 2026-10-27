import { describe, expect, it } from "vitest";

import {
  checkArrival,
  formatTimeOfDay,
  isInsideWindow,
  isValidWindow,
  parseTimeOfDay,
  pickPlannedDay,
  secondsOfDayIn,
  stopTimeWindow,
} from "./delivery-window";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
// 2026-11-02 is a Monday.
const base = {
  today: d("2026-11-02"),
  deliveryWeekdays: [1, 2, 3, 4, 5],
  orderKg: 300,
  capacityKg: 500,
};

describe("pickPlannedDay", () => {
  it("window Tue-Thu, Tue full -> Wed", () => {
    const result = pickPlannedDay({
      ...base,
      window: { from: d("2026-11-03"), to: d("2026-11-05") },
      usedKgByDay: new Map([["2026-11-03", 400]]),
    });
    expect(result).toEqual({ day: d("2026-11-04"), reason: "ok" });
  });

  it("takes the first day when it has room", () => {
    const result = pickPlannedDay({
      ...base,
      window: { from: d("2026-11-03"), to: d("2026-11-05") },
      usedKgByDay: new Map([["2026-11-03", 200]]),
    });
    expect(result.day).toEqual(d("2026-11-03"));
  });

  it("skips non-delivery weekdays", () => {
    const result = pickPlannedDay({
      ...base,
      window: { from: d("2026-11-07"), to: d("2026-11-10") },
      usedKgByDay: new Map(),
    });
    expect(result).toEqual({ day: d("2026-11-09"), reason: "ok" });
  });

  it("never plans a day in the past", () => {
    const result = pickPlannedDay({
      ...base,
      window: { from: d("2026-10-30"), to: d("2026-11-03") },
      usedKgByDay: new Map(),
    });
    expect(result.day).toEqual(d("2026-11-02"));
  });

  it("all days full: earliest delivery weekday, flagged no_capacity", () => {
    const result = pickPlannedDay({
      ...base,
      window: { from: d("2026-11-03"), to: d("2026-11-04") },
      usedKgByDay: new Map([
        ["2026-11-03", 400],
        ["2026-11-04", 450],
      ]),
    });
    expect(result).toEqual({ day: d("2026-11-03"), reason: "no_capacity" });
  });

  it("an empty day accepts an order heavier than any vehicle", () => {
    const result = pickPlannedDay({
      ...base,
      orderKg: 900,
      window: { from: d("2026-11-03"), to: d("2026-11-04") },
      usedKgByDay: new Map(),
    });
    expect(result.reason).toBe("ok");
  });

  it("window without delivery weekday: flagged no_delivery_day", () => {
    const result = pickPlannedDay({
      ...base,
      window: { from: d("2026-11-07"), to: d("2026-11-08") },
      usedKgByDay: new Map(),
    });
    expect(result).toEqual({ day: d("2026-11-07"), reason: "no_delivery_day" });
  });

  it("without known capacity the earliest delivery weekday wins", () => {
    const result = pickPlannedDay({
      ...base,
      capacityKg: null,
      window: { from: d("2026-11-03"), to: d("2026-11-04") },
      usedKgByDay: new Map([["2026-11-03", 99999]]),
    });
    expect(result.day).toEqual(d("2026-11-03"));
  });
});

describe("windows and times", () => {
  it("validates windows", () => {
    const w = (
      from: string,
      to: string,
      fromTime: string | null = null,
      toTime: string | null = null,
    ) => ({
      from: d(from),
      to: d(to),
      fromTime,
      toTime,
    });
    expect(isValidWindow(w("2026-11-03", "2026-11-03"))).toBe(true);
    expect(isValidWindow(w("2026-11-04", "2026-11-03"))).toBe(false);
    expect(isValidWindow(w("2026-11-03", "2026-12-20"))).toBe(false);
    expect(isValidWindow(w("2026-11-03", "2026-11-03", "08:00", "11:00"))).toBe(true);
    expect(isValidWindow(w("2026-11-03", "2026-11-03", "11:00", "08:00"))).toBe(false);
    expect(isValidWindow(w("2026-11-03", "2026-11-04", "11:00", "08:00"))).toBe(true);
    expect(isValidWindow(w("2026-11-03", "2026-11-03", "25:00"))).toBe(false);
  });

  it("parses and formats time of day", () => {
    expect(parseTimeOfDay("08:30")).toBe(30_600);
    expect(parseTimeOfDay("8:30")).toBeNull();
    expect(formatTimeOfDay(30_600)).toBe("08:30");
  });

  it("seconds of day in the factory time zone", () => {
    expect(secondsOfDayIn(new Date("2026-11-03T07:30:00Z"), "Europe/Vienna")).toBe(8.5 * 3600);
  });

  it("isInsideWindow is inclusive", () => {
    const w = { from: d("2026-11-03"), to: d("2026-11-05") };
    expect(isInsideWindow(d("2026-11-03"), w)).toBe(true);
    expect(isInsideWindow(d("2026-11-05"), w)).toBe(true);
    expect(isInsideWindow(d("2026-11-06"), w)).toBe(false);
  });

  it("stop time window: intersection, ignoring days outside, conflict", () => {
    const day = d("2026-11-03");
    const a = { from: day, to: day, fromTime: "08:00", toTime: "11:00" };
    const b = { from: day, to: day, fromTime: "09:00", toTime: null };
    expect(stopTimeWindow([a, b], day)).toEqual({
      fromS: 9 * 3600,
      toS: 11 * 3600,
      conflict: false,
    });
    expect(stopTimeWindow([a], d("2026-11-04"))).toBeNull();
    expect(stopTimeWindow([{ from: day, to: day, fromTime: null, toTime: null }], day)).toBeNull();
    const c = { from: day, to: day, fromTime: "12:00", toTime: "14:00" };
    expect(stopTimeWindow([a, c], day)?.conflict).toBe(true);
  });

  it("08:00-11:00: ETA inside is fine, outside warns", () => {
    const tw = { fromS: 8 * 3600, toS: 11 * 3600, conflict: false };
    expect(checkArrival(9 * 3600, tw)).toBeNull();
    expect(checkArrival(7 * 3600, tw)).toBe("early");
    expect(checkArrival(11.5 * 3600, tw)).toBe("late");
    expect(checkArrival(5, null)).toBeNull();
    expect(checkArrival(9 * 3600, { ...tw, conflict: true })).toBe("conflict");
  });
});
