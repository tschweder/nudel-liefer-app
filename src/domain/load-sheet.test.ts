import { describe, expect, it } from "vitest";

import { loadOrder, type LoadSheetProduct, loadSheetTotals } from "./load-sheet";
import { sumQuantities } from "./order-overview";

const products: LoadSheetProduct[] = [
  { id: "p-spag", sku: "SPAG-5", unit: "PACK", sortOrder: 2 },
  { id: "p-pen", sku: "PEN-5", unit: "PACK", sortOrder: 1 },
  { id: "p-flour", sku: "FLOUR", unit: "KG", sortOrder: 5 },
  { id: "p-crate", sku: "CR", unit: "CRATE", sortOrder: 0 },
];

function thirtyStops() {
  return Array.from({ length: 30 }, (_, i) => ({
    id: `s${i + 1}`,
    sequence: i + 1,
    items: [
      { productId: "p-spag", quantityCents: 100 * ((i % 5) + 1) },
      { productId: "p-pen", quantityCents: 250 },
      ...(i % 3 === 0 ? [{ productId: "p-flour", quantityCents: 1250 + i }] : []),
      ...(i % 7 === 0 ? [{ productId: "p-crate", quantityCents: 100 }] : []),
    ],
  }));
}

describe("loadSheetTotals", () => {
  it("equals the sum of all stops, per product, for a 30-stop tour", () => {
    const stops = thirtyStops();
    const totals = loadSheetTotals(stops, products);
    for (const total of totals) {
      const expected = stops
        .flatMap((s) => s.items)
        .filter((i) => i.productId === total.productId)
        .reduce((sum, i) => sum + i.quantityCents, 0);
      expect(total.quantityCents).toBe(expected);
    }
    // nothing lost, nothing invented: grand total over all lines is identical
    const grand = (xs: Array<{ quantityCents: number }>) =>
      xs.reduce((a, x) => a + x.quantityCents, 0);
    expect(grand(totals)).toBe(grand(stops.flatMap((s) => s.items)));
    expect(totals.find((t) => t.productId === "p-pen")?.quantityCents).toBe(30 * 250);
  });

  it("uses the same aggregation function as the order overview", () => {
    const stops = thirtyStops();
    const viaOverview = sumQuantities(stops.flatMap((s) => s.items)).map(
      (s) => [s.productId, s.quantityCents] as const,
    );
    const viaSheet = loadSheetTotals(stops, products).map(
      (t) => [t.productId, t.quantityCents] as const,
    );
    expect(new Map(viaSheet)).toEqual(new Map(viaOverview));
  });

  it("is exact in hundredths (no float drift)", () => {
    const stops = Array.from({ length: 10 }, (_, i) => ({
      id: `s${i}`,
      sequence: i + 1,
      items: [{ productId: "p-flour", quantityCents: 10 }],
    }));
    expect(loadSheetTotals(stops, products)).toEqual([
      { productId: "p-flour", unit: "KG", quantityCents: 100 },
    ]);
  });

  it("never adds different units together, even for one product id", () => {
    const sums = sumQuantities([
      { productId: "p", unit: "PACK", quantityCents: 500 },
      { productId: "p", unit: "KG", quantityCents: 200 },
      { productId: "p", unit: "PACK", quantityCents: 100 },
    ]);
    expect(sums).toEqual([
      { productId: "p", unit: "KG", quantityCents: 200 },
      { productId: "p", unit: "PACK", quantityCents: 600 },
    ]);
  });

  it("sorts by unit, then catalog order, and keeps unknown products visible", () => {
    const totals = loadSheetTotals(
      [
        {
          items: [
            { productId: "p-flour", quantityCents: 100 },
            { productId: "p-spag", quantityCents: 100 },
            { productId: "p-pen", quantityCents: 100 },
            { productId: "p-crate", quantityCents: 100 },
            { productId: "gone", quantityCents: 300 },
          ],
        },
      ],
      products,
    );
    expect(totals.map((t) => t.productId)).toEqual([
      "p-flour",
      "p-pen",
      "p-spag",
      "p-crate",
      "gone",
    ]);
    expect(totals.at(-1)).toMatchObject({ unit: "", quantityCents: 300 });
  });

  it("returns nothing for a tour without items", () => {
    expect(loadSheetTotals([], products)).toEqual([]);
  });
});

describe("loadOrder", () => {
  it("lists the last stop first and numbers the load positions from 1", () => {
    const ordered = loadOrder([{ sequence: 2 }, { sequence: 1 }, { sequence: 3 }]);
    expect(ordered).toEqual([
      { sequence: 3, loadPosition: 1 },
      { sequence: 2, loadPosition: 2 },
      { sequence: 1, loadPosition: 3 },
    ]);
  });

  it("does not change the input", () => {
    const input = [{ sequence: 1 }, { sequence: 2 }];
    loadOrder(input);
    expect(input).toEqual([{ sequence: 1 }, { sequence: 2 }]);
  });
});
