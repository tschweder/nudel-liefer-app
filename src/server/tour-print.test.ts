import { describe, expect, it } from "vitest";

import { parseTourId } from "./tour-print";

describe("parseTourId", () => {
  it("accepts a short non-empty id and rejects the rest", () => {
    expect(parseTourId("clx123")).toBe("clx123");
    expect(parseTourId("")).toBeNull();
    expect(parseTourId("   ")).toBeNull();
    expect(parseTourId("x".repeat(65))).toBeNull();
    expect(parseTourId(undefined)).toBeNull();
    expect(parseTourId({ id: 1 })).toBeNull();
  });
});
