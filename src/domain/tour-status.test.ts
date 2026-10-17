import { describe, expect, it } from "vitest";

import {
  canTransition,
  deriveTourStatus,
  isReleasedStatus,
  isReReleasable,
  TOUR_STATUSES,
} from "./tour-status";

describe("tour status machine", () => {
  const allowed: Array<[string, string]> = [
    ["DRAFT", "OPTIMIZED"],
    ["OPTIMIZED", "OPTIMIZED"],
    ["OPTIMIZED", "RELEASED"],
    ["RELEASED", "RELEASED"],
    ["RELEASED", "IN_PROGRESS"],
    ["RELEASED", "COMPLETED"],
    ["IN_PROGRESS", "IN_PROGRESS"],
    ["IN_PROGRESS", "COMPLETED"],
  ];

  it("allows exactly the documented transitions", () => {
    for (const from of TOUR_STATUSES) {
      for (const to of TOUR_STATUSES) {
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(
          allowed.some(([a, b]) => a === from && b === to),
        );
      }
    }
  });

  it("never goes backwards and COMPLETED is final", () => {
    expect(canTransition("RELEASED", "OPTIMIZED")).toBe(false);
    expect(canTransition("IN_PROGRESS", "RELEASED")).toBe(false);
    expect(canTransition("COMPLETED", "IN_PROGRESS")).toBe(false);
    expect(canTransition("DRAFT", "RELEASED")).toBe(false);
  });

  it("rejects unknown statuses", () => {
    expect(canTransition("DRAFT", "ARCHIVED")).toBe(false);
    expect(canTransition("nope", "DRAFT")).toBe(false);
    expect(() => deriveTourStatus("nope", [])).toThrow();
  });

  it("classifies statuses", () => {
    expect(isReleasedStatus("OPTIMIZED")).toBe(false);
    expect(isReleasedStatus("RELEASED")).toBe(true);
    expect(isReleasedStatus("COMPLETED")).toBe(true);
    expect(isReReleasable("IN_PROGRESS")).toBe(true);
    expect(isReReleasable("COMPLETED")).toBe(false);
    expect(isReReleasable("DRAFT")).toBe(false);
  });
});

describe("deriveTourStatus", () => {
  it("stays RELEASED until the first stop is done", () => {
    expect(deriveTourStatus("RELEASED", ["PENDING", "PENDING"])).toBe("RELEASED");
  });

  it("is IN_PROGRESS after the first stop (delivered or problem)", () => {
    expect(deriveTourStatus("RELEASED", ["DELIVERED", "PENDING"])).toBe("IN_PROGRESS");
    expect(deriveTourStatus("RELEASED", ["PROBLEM", "PENDING"])).toBe("IN_PROGRESS");
    expect(deriveTourStatus("IN_PROGRESS", ["DELIVERED", "PENDING"])).toBe("IN_PROGRESS");
  });

  it("is COMPLETED when every stop is done, also straight from RELEASED", () => {
    expect(deriveTourStatus("IN_PROGRESS", ["DELIVERED", "PROBLEM"])).toBe("COMPLETED");
    expect(deriveTourStatus("RELEASED", ["DELIVERED"])).toBe("COMPLETED");
  });

  it("leaves unreleased and completed tours alone", () => {
    expect(deriveTourStatus("OPTIMIZED", ["DELIVERED"])).toBe("OPTIMIZED");
    expect(deriveTourStatus("DRAFT", [])).toBe("DRAFT");
    expect(deriveTourStatus("COMPLETED", ["PENDING"])).toBe("COMPLETED");
  });

  it("an empty released tour is not completed", () => {
    expect(deriveTourStatus("RELEASED", [])).toBe("RELEASED");
  });
});
