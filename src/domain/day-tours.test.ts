import { describe, expect, it } from "vitest";

import {
  canCreateFollowUp,
  deliveredStopConflicts,
  findLateOrderIds,
  isOpenTour,
  pickDefaultTour,
  pickDriverTour,
  sortDayTours,
} from "./day-tours";

const tour = (id: string, status: string, minute: number) => ({
  id,
  status,
  createdAt: new Date(Date.UTC(2026, 9, 20, 6, minute)),
});

describe("sortDayTours", () => {
  it("orders by creation time, ties by id, without touching the input", () => {
    const input = [tour("b", "COMPLETED", 5), tour("a", "COMPLETED", 5), tour("c", "OPTIMIZED", 1)];
    expect(sortDayTours(input).map((t) => t.id)).toEqual(["c", "a", "b"]);
    expect(input.map((t) => t.id)).toEqual(["b", "a", "c"]);
  });

  it("accepts ISO strings and timestamps", () => {
    const a = { id: "a", status: "X", createdAt: "2026-10-20T06:00:00.000Z" };
    const b = { id: "b", status: "X", createdAt: Date.UTC(2026, 9, 20, 5) };
    expect(sortDayTours([a, b]).map((t) => t.id)).toEqual(["b", "a"]);
  });
});

describe("pickDefaultTour", () => {
  it("is null for a day without tours", () => {
    expect(pickDefaultTour([])).toBeNull();
  });

  it("is the only tour of an ordinary day, whatever its status", () => {
    expect(pickDefaultTour([tour("a", "COMPLETED", 1)])?.id).toBe("a");
    expect(pickDefaultTour([tour("a", "OPTIMIZED", 1)])?.id).toBe("a");
  });

  it("prefers the newest open tour over a completed one", () => {
    const tours = [tour("t1", "COMPLETED", 1), tour("t2", "OPTIMIZED", 2)];
    expect(pickDefaultTour(tours)?.id).toBe("t2");
    expect(pickDefaultTour([tours[1], tours[0]])?.id).toBe("t2");
  });

  it("falls back to the newest tour when all are completed", () => {
    const tours = [tour("t1", "COMPLETED", 1), tour("t2", "COMPLETED", 2)];
    expect(pickDefaultTour(tours)?.id).toBe("t2");
  });
});

describe("pickDriverTour", () => {
  it("never shows unreleased tours", () => {
    expect(pickDriverTour([tour("a", "OPTIMIZED", 1), tour("b", "DRAFT", 2)])).toBeNull();
  });

  it("shows the follow-up tour once it is released, not the completed one before it", () => {
    const tours = [tour("t1", "COMPLETED", 1), tour("t2", "RELEASED", 2)];
    expect(pickDriverTour(tours)?.id).toBe("t2");
    expect(pickDriverTour([tours[1], tours[0]])?.id).toBe("t2");
    expect(pickDriverTour([tour("t1", "COMPLETED", 1), tour("t2", "IN_PROGRESS", 2)])?.id).toBe(
      "t2",
    );
  });

  it("keeps the completed tour (finished screen) while the follow-up is not released", () => {
    const tours = [tour("t1", "COMPLETED", 1), tour("t2", "OPTIMIZED", 2)];
    expect(pickDriverTour(tours)?.id).toBe("t1");
  });

  it("an active tour wins even when it is older than a completed one", () => {
    const tours = [tour("t1", "IN_PROGRESS", 1), tour("t2", "COMPLETED", 2)];
    expect(pickDriverTour(tours)?.id).toBe("t1");
  });

  it("takes the newest completed tour when none is active", () => {
    const tours = [tour("t1", "COMPLETED", 1), tour("t2", "COMPLETED", 2)];
    expect(pickDriverTour(tours)?.id).toBe("t2");
  });
});

describe("findLateOrderIds", () => {
  const orders = [
    { id: "o1", linkedToTour: true },
    { id: "o2", linkedToTour: false },
  ];

  it("reports orders on no stop when every tour of the day is completed", () => {
    expect(findLateOrderIds([{ status: "COMPLETED" }], orders)).toEqual(["o2"]);
    expect(findLateOrderIds([{ status: "COMPLETED" }, { status: "COMPLETED" }], orders)).toEqual([
      "o2",
    ]);
  });

  it("reports nothing without tours (ordinary planning) or with an open tour (outdated flag)", () => {
    expect(findLateOrderIds([], orders)).toEqual([]);
    for (const status of ["DRAFT", "OPTIMIZED", "RELEASED", "IN_PROGRESS"]) {
      expect(findLateOrderIds([{ status: "COMPLETED" }, { status }], orders)).toEqual([]);
    }
  });

  it("reports nothing when every order is on a stop", () => {
    expect(findLateOrderIds([{ status: "COMPLETED" }], [orders[0]])).toEqual([]);
  });
});

describe("canCreateFollowUp / isOpenTour", () => {
  it("needs completed tours only and at least one late order", () => {
    expect(canCreateFollowUp([{ status: "COMPLETED" }], 1)).toBe(true);
    expect(canCreateFollowUp([{ status: "COMPLETED" }], 0)).toBe(false);
    expect(canCreateFollowUp([], 2)).toBe(false);
    expect(canCreateFollowUp([{ status: "COMPLETED" }, { status: "OPTIMIZED" }], 2)).toBe(false);
  });

  it("COMPLETED is the only closed status", () => {
    expect(isOpenTour("COMPLETED")).toBe(false);
    expect(isOpenTour("IN_PROGRESS")).toBe(true);
  });
});

describe("deliveredStopConflicts", () => {
  const stop = {
    id: "s1",
    customerId: "c1",
    orderIds: ["o1"],
    items: [{ productId: "p1", quantity: 5 }],
  };
  const order = (qty: number) => ({
    id: "o1",
    customerId: "c1",
    items: [{ productId: "p1", quantity: qty }],
  });

  it("is empty when the linked orders still match what was delivered", () => {
    expect(deliveredStopConflicts([stop], [order(5)])).toEqual([]);
  });

  it("reports an increased quantity on a delivered stop", () => {
    expect(deliveredStopConflicts([stop], [order(8)])).toEqual([
      {
        stopId: "s1",
        customerId: "c1",
        items: [{ productId: "p1", before: 5, after: 8 }],
      },
    ]);
  });

  it("reports an order that was cancelled after delivery", () => {
    expect(deliveredStopConflicts([stop], [])).toEqual([
      {
        stopId: "s1",
        customerId: "c1",
        items: [{ productId: "p1", before: 5, after: 0 }],
      },
    ]);
  });

  it("ignores orders that are not linked to the stop (they are late orders, not conflicts)", () => {
    const late = { id: "o9", customerId: "c1", items: [{ productId: "p1", quantity: 3 }] };
    expect(deliveredStopConflicts([stop], [order(5), late])).toEqual([]);
  });
});
