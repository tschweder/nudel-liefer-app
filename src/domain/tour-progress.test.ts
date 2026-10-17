import { describe, expect, it } from "vitest";

import {
  DEFAULT_POLL_INTERVAL_MS,
  isLiveStatus,
  parsePollInterval,
  showsStopResults,
  summarizeProgress,
} from "./tour-progress";

const stops = (...statuses: string[]) =>
  statuses.map((status, i) => ({ id: `s${i + 1}`, sequence: i + 1, status }));

describe("summarizeProgress", () => {
  it("counts delivered and problem stops as done and finds the next open stop", () => {
    expect(
      summarizeProgress(stops("DELIVERED", "PROBLEM", "PENDING", "PENDING", "DELIVERED")),
    ).toEqual({
      total: 5,
      delivered: 2,
      problems: 1,
      done: 3,
      pending: 2,
      percent: 60,
      nextStopId: "s3",
    });
  });

  it("picks the next stop by sequence, not by array order", () => {
    const shuffled = [
      { id: "b", sequence: 2, status: "PENDING" },
      { id: "a", sequence: 1, status: "PENDING" },
    ];
    expect(summarizeProgress(shuffled).nextStopId).toBe("a");
  });

  it("has no next stop when everything is done or the tour is empty", () => {
    expect(summarizeProgress(stops("DELIVERED", "PROBLEM"))).toMatchObject({
      percent: 100,
      pending: 0,
      nextStopId: null,
    });
    expect(summarizeProgress([])).toMatchObject({ total: 0, percent: 0, nextStopId: null });
  });
});

describe("status helpers", () => {
  it("live = released or in progress; results shown also when completed", () => {
    expect(
      ["DRAFT", "OPTIMIZED", "RELEASED", "IN_PROGRESS", "COMPLETED"].map(isLiveStatus),
    ).toEqual([false, false, true, true, false]);
    expect(
      ["DRAFT", "OPTIMIZED", "RELEASED", "IN_PROGRESS", "COMPLETED"].map(showsStopResults),
    ).toEqual([false, false, true, true, true]);
  });
});

describe("parsePollInterval", () => {
  it("defaults to 30 s", () => {
    expect(DEFAULT_POLL_INTERVAL_MS).toBe(30_000);
    expect(parsePollInterval(undefined)).toBe(30_000);
    expect(parsePollInterval("")).toBe(30_000);
    expect(parsePollInterval("abc")).toBe(30_000);
    expect(parsePollInterval("-5")).toBe(30_000);
  });

  it("accepts values between 1 s and 5 min only", () => {
    expect(parsePollInterval("3000")).toBe(3000);
    expect(parsePollInterval("999")).toBe(30_000);
    expect(parsePollInterval("300000")).toBe(300_000);
    expect(parsePollInterval("300001")).toBe(30_000);
  });
});
