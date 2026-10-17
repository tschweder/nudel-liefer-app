import { describe, expect, it } from "vitest";

import {
  isUnseenChange,
  nextPendingStop,
  progressOf,
  remainingSeconds,
  roundedMinutes,
  summarizeItems,
} from "./driver-today";

describe("nextPendingStop", () => {
  it("is the lowest-sequence PENDING stop, whatever the array order", () => {
    const stops = [
      { sequence: 3, status: "PENDING" },
      { sequence: 1, status: "DELIVERED" },
      { sequence: 2, status: "PROBLEM" },
      { sequence: 5, status: "PENDING" },
      { sequence: 4, status: "PENDING" },
    ];
    expect(nextPendingStop(stops)?.sequence).toBe(3);
  });
  it("skips a pending stop behind a problem stop and returns null when all are done", () => {
    expect(nextPendingStop([{ sequence: 1, status: "DELIVERED" }])).toBeNull();
    expect(nextPendingStop([])).toBeNull();
  });
});

describe("progressOf", () => {
  it("counts delivered and problem stops as done", () => {
    expect(
      progressOf([
        { sequence: 1, status: "DELIVERED" },
        { sequence: 2, status: "PROBLEM" },
        { sequence: 3, status: "PENDING" },
      ]),
    ).toEqual({ done: 2, total: 3 });
  });
});

describe("summarizeItems", () => {
  it("never adds different units together", () => {
    const summary = summarizeItems([
      { productId: "a", unit: "KG", quantityCents: 1000 },
      { productId: "b", unit: "PACK", quantityCents: 500 },
      { productId: "c", unit: "KG", quantityCents: 1750 },
    ]);
    expect(summary).toEqual({
      kinds: 3,
      totals: [
        { unit: "KG", quantityCents: 2750 },
        { unit: "PACK", quantityCents: 500 },
      ],
    });
  });
  it("is empty for no items", () => {
    expect(summarizeItems([])).toEqual({ kinds: 0, totals: [] });
  });
  it("orders units KG, PACK, CRATE, PIECE", () => {
    const units = summarizeItems(
      ["PIECE", "CRATE", "PACK", "KG"].map((unit, i) => ({
        productId: String(i),
        unit,
        quantityCents: 100,
      })),
    ).totals.map((t) => t.unit);
    expect(units).toEqual(["KG", "PACK", "CRATE", "PIECE"]);
  });
});

describe("remainingSeconds", () => {
  it("sums legs and service of open stops only", () => {
    expect(
      remainingSeconds(
        [
          { sequence: 1, status: "DELIVERED", legDurationS: 600 },
          { sequence: 2, status: "PENDING", legDurationS: 300 },
          { sequence: 3, status: "PENDING", legDurationS: null },
        ],
        600,
      ),
    ).toBe(300 + 600 + 600);
  });
  it("rounds minutes up to 5", () => {
    expect(roundedMinutes(0)).toBe(0);
    expect(roundedMinutes(61)).toBe(5);
    expect(roundedMinutes(25 * 60)).toBe(25);
    expect(roundedMinutes(26 * 60)).toBe(30);
  });
});

describe("isUnseenChange", () => {
  it("compares the change revision with the last seen one", () => {
    expect(isUnseenChange({ change: "CHANGED", changedInRevision: 2 }, 1)).toBe(true);
    expect(isUnseenChange({ change: "CHANGED", changedInRevision: 2 }, 2)).toBe(false);
    expect(isUnseenChange({ change: null, changedInRevision: null }, 0)).toBe(false);
    expect(isUnseenChange({ change: "ADDED", changedInRevision: 3 }, 0)).toBe(true);
  });
});
