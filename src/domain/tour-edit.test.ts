import { describe, expect, it } from "vitest";

import { canEditTour, mergePendingOrder } from "./tour-edit";

const stop = (id: string, status = "PENDING") => ({ id, status });

describe("canEditTour", () => {
  it("allows every tour that is not completed", () => {
    for (const s of ["DRAFT", "OPTIMIZED", "RELEASED", "IN_PROGRESS"]) {
      expect(canEditTour(s)).toBe(true);
    }
    expect(canEditTour("COMPLETED")).toBe(false);
    expect(canEditTour("nonsense")).toBe(false);
  });
});

describe("mergePendingOrder", () => {
  it("applies the requested order to pending stops", () => {
    const current = [stop("a"), stop("b"), stop("c")];
    expect(mergePendingOrder(current, new Set(), ["c", "a", "b"])).toEqual(["c", "a", "b"]);
  });

  it("keeps completed stops in their slot", () => {
    const current = [stop("a", "DELIVERED"), stop("b"), stop("c", "PROBLEM"), stop("d")];
    expect(mergePendingOrder(current, new Set(), ["d", "b"])).toEqual(["a", "d", "c", "b"]);
  });

  it("drops moved stops and closes the gap", () => {
    const current = [stop("a"), stop("b"), stop("c")];
    expect(mergePendingOrder(current, new Set(["b"]), ["c", "a"])).toEqual(["c", "a"]);
  });

  it("rejects a request that is not the set of staying pending stops", () => {
    const current = [stop("a"), stop("b", "DELIVERED"), stop("c")];
    expect(mergePendingOrder(current, new Set(), ["a"])).toBeNull();
    expect(mergePendingOrder(current, new Set(), ["a", "b"])).toBeNull();
    expect(mergePendingOrder(current, new Set(), ["a", "a"])).toBeNull();
    expect(mergePendingOrder(current, new Set(["c"]), ["a", "c"])).toBeNull();
  });
});
