import { describe, expect, it } from "vitest";

import { isWithinUndoWindow, nextPendingAfter, UNDO_WINDOW_MS, undoDeadline } from "./stop-status";

const stop = (id: string, sequence: number, status = "PENDING") => ({ id, sequence, status });

describe("undo window", () => {
  const at = new Date("2099-07-02T08:00:00Z");
  it("lasts exactly five minutes", () => {
    expect(UNDO_WINDOW_MS).toBe(300_000);
    expect(undoDeadline(at).toISOString()).toBe("2099-07-02T08:05:00.000Z");
    expect(isWithinUndoWindow(at, new Date("2099-07-02T08:00:00Z"))).toBe(true);
    expect(isWithinUndoWindow(at, new Date("2099-07-02T08:05:00Z"))).toBe(true);
    expect(isWithinUndoWindow(at, new Date("2099-07-02T08:05:00.001Z"))).toBe(false);
  });
});

describe("nextPendingAfter", () => {
  it("takes the next pending stop in tour order", () => {
    const stops = [stop("c", 3), stop("a", 1, "DELIVERED"), stop("b", 2, "DELIVERED")];
    expect(nextPendingAfter(stops, "b")?.id).toBe("c");
  });
  it("skips done stops", () => {
    const stops = [stop("a", 1, "DELIVERED"), stop("b", 2, "PROBLEM"), stop("c", 3), stop("d", 4)];
    expect(nextPendingAfter(stops, "a")?.id).toBe("c");
  });
  it("falls back to an earlier pending stop when nothing is pending behind", () => {
    const stops = [stop("a", 1), stop("b", 2, "DELIVERED"), stop("c", 3, "DELIVERED")];
    expect(nextPendingAfter(stops, "c")?.id).toBe("a");
  });
  it("is null when nothing is pending", () => {
    const stops = [stop("a", 1, "DELIVERED"), stop("b", 2, "PROBLEM")];
    expect(nextPendingAfter(stops, "b")).toBeNull();
  });
  it("never returns the current stop", () => {
    expect(nextPendingAfter([stop("a", 1)], "a")).toBeNull();
  });
});
