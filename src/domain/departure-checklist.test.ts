import { describe, expect, it } from "vitest";

import {
  buildDepartureChecklist,
  checklistLineIds,
  type ChecklistStop,
  parseTicked,
  showDepartureCard,
} from "./departure-checklist";
import { loadSheetTotals } from "./load-sheet";

const item = (productId: string, unit: string, quantity: number, name = productId) => ({
  productId,
  unit,
  quantity,
  name,
});

const STOPS: ChecklistStop[] = [
  {
    customerId: "c1",
    customerName: "KundeTest2",
    hasKey: true,
    keyNumber: "12",
    items: [item("karton", "CRATE", 4, "Nudeln"), item("beutel", "PACK", 5, "Nudeln")],
  },
  {
    customerId: "c2",
    customerName: "Bei Wang",
    hasKey: false,
    keyNumber: null,
    items: [item("karton", "CRATE", 10, "Nudeln"), item("teig", "PIECE", 3, "Wantan-Teig")],
  },
  {
    customerId: "c3",
    customerName: "Ohne Nummer",
    hasKey: true,
    keyNumber: null,
    items: [item("beutel", "PACK", 17, "Nudeln")],
  },
  {
    customerId: "c4",
    customerName: "Unbekannt",
    hasKey: null,
    items: [item("beutel", "PACK", 1, "Nudeln")],
  },
  {
    trip: 2,
    customerId: "c5",
    customerName: "Zweite Fahrt",
    hasKey: true,
    keyNumber: "31",
    items: [item("karton", "CRATE", 2, "Nudeln")],
  },
];

describe("buildDepartureChecklist", () => {
  it("sums the products per unit exactly like the load sheet, in packaging units", () => {
    const { products } = buildDepartureChecklist(STOPS, 1);
    expect(products.map((p) => [p.quantity, p.unit, p.name])).toEqual([
      [23, "PACK", "Nudeln"],
      [14, "CRATE", "Nudeln"],
      [3, "PIECE", "Wantan-Teig"],
    ]);
    // The very same function the printed sheet uses: identical totals for the same stops.
    const sheet = loadSheetTotals(
      STOPS.filter((s) => (s.trip ?? 1) === 1),
      [
        { id: "beutel", sku: "b", unit: "PACK", sortOrder: 1 },
        { id: "karton", sku: "k", unit: "CRATE", sortOrder: 2 },
        { id: "teig", sku: "t", unit: "PIECE", sortOrder: 3 },
      ],
    );
    expect(products.map((p) => [p.productId, p.quantity])).toEqual(
      sheet.map((row) => [row.productId, row.quantity]),
    );
  });

  it("builds one checklist per trip", () => {
    const second = buildDepartureChecklist(STOPS, 2);
    expect(second.products.map((p) => [p.quantity, p.unit])).toEqual([[2, "CRATE"]]);
    expect(second.keys.map((k) => k.keyNumber)).toEqual(["31"]);
    expect(buildDepartureChecklist(STOPS, 3)).toEqual({ products: [], keys: [] });
  });

  it("lists one line per customer whose key exists, in delivery order", () => {
    const { keys } = buildDepartureChecklist(STOPS, 1);
    expect(keys.map((k) => [k.customerName, k.keyNumber])).toEqual([
      ["KundeTest2", "12"],
      ["Ohne Nummer", null], // a key without a noted number is still taken along
    ]);
  });

  it("lists a customer with two stops of the trip once", () => {
    const twice = [STOPS[0]!, { ...STOPS[0]!, items: [] }];
    expect(buildDepartureChecklist(twice, 1).keys).toHaveLength(1);
  });

  it("gives every line a stable id and counts the fixed items", () => {
    const list = buildDepartureChecklist(STOPS, 1);
    const ids = checklistLineIds(list, [{ id: "c1" }]);
    expect(ids).toEqual(["p:beutel", "p:karton", "p:teig", "k:c1", "k:c3", "f:c1"]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("showDepartureCard", () => {
  const base = { tourStatus: "RELEASED", departedAt: null, stopStatuses: ["PENDING", "PENDING"] };
  it("is offered before the first stop", () => {
    expect(showDepartureCard(base)).toBe(true);
    expect(showDepartureCard({ ...base, tourStatus: "IN_PROGRESS" })).toBe(true);
  });
  it("is gone once the driver has left, started the stops or the tour is over", () => {
    expect(showDepartureCard({ ...base, departedAt: "2099-07-02T05:55:00Z" })).toBe(false);
    expect(showDepartureCard({ ...base, stopStatuses: ["DELIVERED", "PENDING"] })).toBe(false);
    expect(showDepartureCard({ ...base, stopStatuses: ["PROBLEM", "PENDING"] })).toBe(false);
    expect(showDepartureCard({ ...base, tourStatus: "COMPLETED" })).toBe(false);
    expect(showDepartureCard({ ...base, stopStatuses: [] })).toBe(false);
  });
});

describe("parseTicked", () => {
  it("keeps only known ids of a well-formed list", () => {
    const valid = new Set(["p:a", "k:b"]);
    expect([...parseTicked(["p:a", "gone", 5, "k:b"], valid)]).toEqual(["p:a", "k:b"]);
    expect(parseTicked("nope", valid).size).toBe(0);
    expect(parseTicked(null, valid).size).toBe(0);
  });
});
