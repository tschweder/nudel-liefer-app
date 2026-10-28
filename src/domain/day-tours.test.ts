import { describe, expect, it } from "vitest";

import {
  canCreateFollowUp,
  correctionCandidates,
  deliveredStopConflicts,
  driverDayTours,
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

describe("driverDayTours", () => {
  it("is empty for a day without released tours", () => {
    expect(driverDayTours([])).toEqual([]);
  });

  it("lists every open tour of the day, oldest first, whatever the order of the input", () => {
    const tours = [
      tour("t3", "RELEASED", 3),
      tour("t1", "IN_PROGRESS", 1),
      tour("t2", "RELEASED", 2),
    ];
    expect(driverDayTours(tours).map((t) => t.id)).toEqual(["t1", "t2", "t3"]);
    expect(driverDayTours([tours[2], tours[1]]).map((t) => t.id)).toEqual(["t1", "t2"]);
  });

  it("keeps the newest open tour as the last (active) one, like pickDriverTour", () => {
    const tours = [tour("t1", "RELEASED", 1), tour("t2", "RELEASED", 2), tour("t3", "RELEASED", 3)];
    const visible = driverDayTours(tours);
    expect(visible.at(-1)?.id).toBe("t3");
    expect(visible.at(-1)?.id).toBe(pickDriverTour(tours)?.id);
  });

  it("shows only the newest completed tour once everything is finished (finished screen)", () => {
    const tours = [tour("t1", "COMPLETED", 1), tour("t2", "COMPLETED", 2)];
    expect(driverDayTours(tours).map((t) => t.id)).toEqual(["t2"]);
    expect(driverDayTours([tour("t1", "COMPLETED", 1)]).map((t) => t.id)).toEqual(["t1"]);
  });

  it("drops the completed tour of an ordinary follow-up day (only open ones are listed)", () => {
    const tours = [tour("t1", "COMPLETED", 1), tour("t2", "RELEASED", 2)];
    expect(driverDayTours(tours).map((t) => t.id)).toEqual(["t2"]);
  });

  it("is a pure function that leaves the input alone", () => {
    const tours = [tour("t2", "RELEASED", 2), tour("t1", "RELEASED", 1)];
    driverDayTours(tours);
    expect(tours.map((t) => t.id)).toEqual(["t2", "t1"]);
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

describe("correctionCandidates (NUD-117)", () => {
  const conflict = (items: Array<{ productId: string; before: number; after: number }>) => ({
    stopId: "s1",
    customerId: "c1",
    items,
  });
  const increase = conflict([{ productId: "p1", before: 2, after: 5 }]);
  const onlyStop = [{ id: "s1", customerId: "c1" }];
  const linkedOrders = [{ customerId: "c1", linkedToStop: true }];

  it("offers exactly the increase of a delivered stop", () => {
    expect(correctionCandidates([increase], onlyStop, linkedOrders)).toEqual([
      { stopId: "s1", customerId: "c1", items: [{ productId: "p1", quantity: 3 }] },
    ]);
  });

  it("keeps only the increased products when others shrink in the same edit", () => {
    const mixed = conflict([
      { productId: "p1", before: 2, after: 5 },
      { productId: "p2", before: 4, after: 1 },
      { productId: "p3", before: 0, after: 2 },
    ]);
    expect(correctionCandidates([mixed], onlyStop, linkedOrders)[0]!.items).toEqual([
      { productId: "p1", quantity: 3 },
      { productId: "p3", quantity: 2 },
    ]);
  });

  it("never offers a decrease or a cancellation (goods cannot be un-delivered)", () => {
    const decrease = conflict([{ productId: "p1", before: 5, after: 2 }]);
    const cancelled = conflict([{ productId: "p1", before: 5, after: 0 }]);
    expect(correctionCandidates([decrease], onlyStop, linkedOrders)).toEqual([]);
    expect(correctionCandidates([cancelled], onlyStop, linkedOrders)).toEqual([]);
    expect(correctionCandidates([], onlyStop, linkedOrders)).toEqual([]);
  });

  it("offers nothing once the customer has another stop on that day (difference planned)", () => {
    const followUpStop = [...onlyStop, { id: "s2", customerId: "c1" }];
    expect(correctionCandidates([increase], followUpStop, linkedOrders)).toEqual([]);
    // Another customer's stop does not matter.
    const otherCustomer = [...onlyStop, { id: "s3", customerId: "c2" }];
    expect(correctionCandidates([increase], otherCustomer, linkedOrders)).toHaveLength(1);
  });

  it("offers nothing while an order of the customer still waits for a tour", () => {
    const waiting = [...linkedOrders, { customerId: "c1", linkedToStop: false }];
    expect(correctionCandidates([increase], onlyStop, waiting)).toEqual([]);
    // A pending order of another customer does not matter.
    const otherWaiting = [...linkedOrders, { customerId: "c2", linkedToStop: false }];
    expect(correctionCandidates([increase], onlyStop, otherWaiting)).toHaveLength(1);
  });

  it("treats every conflict on its own customer", () => {
    const second = {
      stopId: "s4",
      customerId: "c2",
      items: [{ productId: "p1", before: 1, after: 4 }],
    };
    const stops = [...onlyStop, { id: "s4", customerId: "c2" }];
    const orders = [...linkedOrders, { customerId: "c2", linkedToStop: true }];
    expect(correctionCandidates([increase, second], stops, orders)).toEqual([
      { stopId: "s1", customerId: "c1", items: [{ productId: "p1", quantity: 3 }] },
      { stopId: "s4", customerId: "c2", items: [{ productId: "p1", quantity: 3 }] },
    ]);
  });
});
