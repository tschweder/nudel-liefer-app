import { describe, expect, it } from "vitest";

import {
  isEmptyDiff,
  itemChanges,
  outdatedTourDates,
  planReRelease,
  sameItems,
  type SnapshotStop,
} from "./tour-diff";

const item = (productId: string, quantity: number) => ({ productId, quantity });
const order = (id: string, customerId: string, items: Array<[string, number]>) => ({
  id,
  customerId,
  items: items.map(([productId, quantity]) => ({ productId, quantity })),
});
const stop = (
  id: string,
  customerId: string,
  sequence: number,
  orderIds: string[],
  items: Array<[string, number]>,
  completed = false,
): SnapshotStop => ({
  id,
  customerId,
  sequence,
  completed,
  orderIds,
  items: items.map(([p, q]) => item(p, q)),
});

describe("sameItems / itemChanges", () => {
  it("ignores order and zero lines", () => {
    expect(sameItems([item("a", 1), item("b", 3)], [item("b", 3), item("a", 1)])).toBe(true);
    expect(sameItems([item("a", 1), item("z", 0)], [item("a", 1)])).toBe(true);
    expect(sameItems([item("a", 1)], [item("a", 2)])).toBe(false);
  });

  it("lists changed, added and removed products", () => {
    expect(itemChanges([item("a", 5), item("b", 1)], [item("a", 8), item("c", 2)])).toEqual([
      { productId: "a", before: 5, after: 8 },
      { productId: "b", before: 1, after: 0 },
      { productId: "c", before: 0, after: 2 },
    ]);
    expect(itemChanges([item("a", 5)], [item("a", 5)])).toEqual([]);
  });
});

describe("planReRelease", () => {
  const stops = [
    stop("s1", "c1", 1, ["o1"], [["a", 5]]),
    stop(
      "s2",
      "c2",
      2,
      ["o2"],
      [
        ["a", 2],
        ["b", 1],
      ],
    ),
    stop("s3", "c3", 3, ["o3"], [["b", 3]]),
  ];

  it("reports nothing when the orders still match the released quantities", () => {
    const plan = planReRelease(stops, [
      order("o1", "c1", [["a", 5]]),
      order("o2", "c2", [
        ["a", 2],
        ["b", 1],
      ]),
      order("o3", "c3", [["b", 3]]),
    ]);
    expect(isEmptyDiff(plan.diff)).toBe(true);
    expect(plan.entries.map((e) => e.kind)).toEqual(["existing", "existing", "existing"]);
    expect(plan.removedStopIds).toEqual([]);
  });

  it("reports a changed quantity with before and after", () => {
    const plan = planReRelease(stops, [
      order("o1", "c1", [["a", 8]]),
      order("o2", "c2", [
        ["a", 2],
        ["b", 1],
      ]),
      order("o3", "c3", [["b", 3]]),
    ]);
    expect(plan.diff.changed).toEqual([
      {
        stopId: "s1",
        customerId: "c1",
        items: [{ productId: "a", before: 5, after: 8 }],
      },
    ]);
    expect(plan.diff.added).toEqual([]);
    expect(plan.diff.removed).toEqual([]);
  });

  it("reports removed stops (all orders cancelled) and added stops (new customer)", () => {
    const plan = planReRelease(stops, [
      order("o1", "c1", [["a", 5]]),
      order("o3", "c3", [["b", 3]]),
      order("o9", "c9", [["b", 4]]),
    ]);
    expect(plan.diff.removed.map((r) => r.stopId)).toEqual(["s2"]);
    expect(plan.diff.added).toEqual([{ customerId: "c9", items: [item("b", 4)] }]);
    expect(plan.removedStopIds).toEqual(["s2"]);
    // order: kept stops keep their relative order, the new customer comes last
    expect(
      plan.entries.map((e) =>
        e.kind === "new" ? `new:${e.customerId}` : (e as { stopId: string }).stopId,
      ),
    ).toEqual(["s1", "s3", "new:c9"]);
  });

  it("merges several orders of a customer into the stop and links them all", () => {
    const plan = planReRelease(stops, [
      order("o1", "c1", [["a", 5]]),
      order("o1b", "c1", [
        ["a", 1],
        ["b", 2],
      ]),
      order("o2", "c2", [
        ["a", 2],
        ["b", 1],
      ]),
      order("o3", "c3", [["b", 3]]),
    ]);
    const first = plan.entries[0];
    expect(first.kind).toBe("existing");
    if (first.kind === "existing") {
      expect(first.orderIds).toEqual(["o1", "o1b"]);
      expect(first.items).toEqual([item("a", 6), item("b", 2)]);
    }
    expect(plan.diff.changed[0].items).toEqual([
      { productId: "a", before: 5, after: 6 },
      { productId: "b", before: 0, after: 2 },
    ]);
  });

  it("a replaced order with equal quantities is no visible change", () => {
    const plan = planReRelease(stops, [
      order("o1x", "c1", [["a", 5]]),
      order("o2", "c2", [
        ["a", 2],
        ["b", 1],
      ]),
      order("o3", "c3", [["b", 3]]),
    ]);
    expect(isEmptyDiff(plan.diff)).toBe(true);
    const first = plan.entries[0];
    expect(first.kind === "existing" && first.orderIds).toEqual(["o1x"]);
  });

  describe("completed stops", () => {
    const withDone = [
      stop("s1", "c1", 1, ["o1"], [["a", 5]], true),
      stop("s2", "c2", 2, ["o2"], [["a", 2]]),
    ];

    it("are kept in place, never removed or changed, even when their orders are gone", () => {
      const plan = planReRelease(withDone, [order("o2", "c2", [["a", 9]])]);
      expect(plan.entries[0]).toEqual({ kind: "completed", stopId: "s1", customerId: "c1" });
      expect(plan.removedStopIds).toEqual([]);
      expect(plan.diff.completedChanged).toEqual([
        {
          stopId: "s1",
          customerId: "c1",
          items: [{ productId: "a", before: 5, after: 0 }],
        },
      ]);
      expect(plan.diff.changed.map((c) => c.stopId)).toEqual(["s2"]);
    });

    it("an edit of a delivered order is reported but not re-dispatched", () => {
      const plan = planReRelease(withDone, [
        order("o1", "c1", [["a", 8]]),
        order("o2", "c2", [["a", 2]]),
      ]);
      expect(plan.diff.completedChanged).toHaveLength(1);
      expect(plan.diff.added).toEqual([]);
      expect(plan.diff.changed).toEqual([]);
      expect(plan.entries.map((e) => e.kind)).toEqual(["completed", "existing"]);
    });

    it("a new order of an already delivered customer becomes a second visit at the end", () => {
      const plan = planReRelease(withDone, [
        order("o1", "c1", [["a", 5]]),
        order("o2", "c2", [["a", 2]]),
        order("o5", "c1", [["b", 1]]),
      ]);
      expect(plan.diff.added).toEqual([{ customerId: "c1", items: [item("b", 1)] }]);
      expect(plan.entries.map((e) => e.kind)).toEqual(["completed", "existing", "new"]);
      expect(isEmptyDiff(plan.diff)).toBe(false);
    });

    it("an unchanged completed stop is not reported", () => {
      const plan = planReRelease(withDone, [
        order("o1", "c1", [["a", 5]]),
        order("o2", "c2", [["a", 2]]),
      ]);
      expect(isEmptyDiff(plan.diff)).toBe(true);
    });
  });

  it("keeps the stored order by sequence regardless of input order", () => {
    const plan = planReRelease(
      [stops[2], stops[0], stops[1]],
      [
        order("o1", "c1", [["a", 5]]),
        order("o2", "c2", [
          ["a", 2],
          ["b", 1],
        ]),
        order("o3", "c3", [["b", 3]]),
      ],
    );
    expect(plan.entries.map((e) => (e as { stopId: string }).stopId)).toEqual(["s1", "s2", "s3"]);
  });
});

describe("outdatedTourDates", () => {
  const d1 = new Date("2099-06-15T00:00:00Z");
  const d2 = new Date("2099-06-16T00:00:00Z");
  const state = (
    status: string,
    date = d1,
    items: Array<[string, number]> = [["a", 5]],
    customerId = "c1",
  ) => ({
    status,
    customerId,
    deliveryDate: date,
    items: items.map(([productId, quantity]) => ({ productId, quantity })),
  });
  const days = (dates: Date[]) => dates.map((d) => d.toISOString().slice(0, 10));

  it("flags the day of a new confirmed order, not of a draft", () => {
    expect(days(outdatedTourDates(null, state("CONFIRMED")))).toEqual(["2099-06-15"]);
    expect(outdatedTourDates(null, state("DRAFT"))).toEqual([]);
  });

  it("flags when a confirmed order changes quantity", () => {
    expect(days(outdatedTourDates(state("CONFIRMED"), state("CONFIRMED", d1, [["a", 6]])))).toEqual(
      ["2099-06-15"],
    );
  });

  it("does not flag a save without a relevant change (same quantities, any notation)", () => {
    expect(outdatedTourDates(state("CONFIRMED"), state("CONFIRMED", d1, [["a", 5]]))).toEqual([]);
  });

  it("flags both days when a confirmed order moves", () => {
    expect(days(outdatedTourDates(state("CONFIRMED"), state("CONFIRMED", d2)))).toEqual([
      "2099-06-15",
      "2099-06-16",
    ]);
  });

  it("draft edits flag nothing; confirm and un-confirm do", () => {
    expect(outdatedTourDates(state("DRAFT"), state("DRAFT", d1, [["a", 9]]))).toEqual([]);
    expect(days(outdatedTourDates(state("DRAFT"), state("CONFIRMED")))).toEqual(["2099-06-15"]);
    expect(days(outdatedTourDates(state("CONFIRMED"), state("DRAFT")))).toEqual(["2099-06-15"]);
  });

  it("cancelling flags only when the order was confirmed", () => {
    expect(days(outdatedTourDates(state("CONFIRMED"), state("CANCELLED")))).toEqual(["2099-06-15"]);
    expect(outdatedTourDates(state("DRAFT"), state("CANCELLED"))).toEqual([]);
  });
});
