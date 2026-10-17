import { describe, expect, it } from "vitest";

import {
  durationParts,
  isPermutation,
  isTourEditable,
  moveItem,
  releaseBlocker,
  sameOrder,
} from "./tour-plan";

describe("tour plan rules", () => {
  it("only DRAFT and OPTIMIZED tours are editable", () => {
    expect(["DRAFT", "OPTIMIZED"].every(isTourEditable)).toBe(true);
    expect(["RELEASED", "IN_PROGRESS", "COMPLETED"].some(isTourEditable)).toBe(false);
  });

  it("moveItem moves one item and clamps the target", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveItem(["a", "b", "c"], 1, 99)).toEqual(["a", "c", "b"]);
    expect(moveItem(["a", "b", "c"], 1, -5)).toEqual(["b", "a", "c"]);
    expect(moveItem(["a", "b"], 5, 0)).toEqual(["a", "b"]);
    const input = ["a", "b"];
    moveItem(input, 0, 1);
    expect(input).toEqual(["a", "b"]);
  });

  it("isPermutation needs the same ids, each once", () => {
    expect(isPermutation(["a", "b", "c"], ["c", "a", "b"])).toBe(true);
    expect(isPermutation(["a", "b"], ["a"])).toBe(false);
    expect(isPermutation(["a", "b"], ["a", "a"])).toBe(false);
    expect(isPermutation(["a", "b"], ["a", "x"])).toBe(false);
    expect(isPermutation([], [])).toBe(true);
  });

  it("sameOrder compares positions", () => {
    expect(sameOrder(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameOrder(["a", "b"], ["b", "a"])).toBe(false);
  });

  it("releaseBlocker reports the first blocker", () => {
    const ok = { status: "OPTIMIZED", stopCount: 2, driverId: "d1", isOutdated: false };
    expect(releaseBlocker(ok)).toBeNull();
    expect(releaseBlocker({ ...ok, status: "RELEASED" })).toBe("tour_not_editable");
    expect(releaseBlocker({ ...ok, stopCount: 0 })).toBe("no_stops");
    expect(releaseBlocker({ ...ok, driverId: null })).toBe("driver_required");
    expect(releaseBlocker({ ...ok, isOutdated: true })).toBe("outdated");
    expect(releaseBlocker({ ...ok, driverId: null, isOutdated: true })).toBe("driver_required");
  });

  it("durationParts rounds up to full minutes", () => {
    expect(durationParts(0)).toEqual({ hours: 0, minutes: 0 });
    expect(durationParts(61)).toEqual({ hours: 0, minutes: 2 });
    expect(durationParts(3600)).toEqual({ hours: 1, minutes: 0 });
    expect(durationParts(5400)).toEqual({ hours: 1, minutes: 30 });
  });
});
