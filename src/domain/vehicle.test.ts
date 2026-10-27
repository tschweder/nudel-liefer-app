import { describe, expect, it } from "vitest";

import { loadState, MAX_CAPACITY_KG, parseCapacityKg, tourLoadKg } from "./vehicle";

describe("parseCapacityKg", () => {
  it("accepts whole kilograms", () => {
    expect(parseCapacityKg("1200")).toBe(1200);
    expect(parseCapacityKg(" 800 ")).toBe(800);
    expect(parseCapacityKg(1)).toBe(1);
    expect(parseCapacityKg(MAX_CAPACITY_KG)).toBe(MAX_CAPACITY_KG);
  });

  it("refuses zero, decimals, negatives, text and too large values", () => {
    for (const bad of ["0", "12,5", "12.5", "-3", "abc", "", "50001", "1e3", 0, 50001]) {
      expect(parseCapacityKg(bad)).toBeNull();
    }
  });
});

describe("tourLoadKg", () => {
  const products = [
    { id: "bag", weightKgPerUnit: 3 },
    { id: "crate", weightKgPerUnit: "10.00" },
    { id: "dough", weightKgPerUnit: 5 },
  ];

  it("sums the weight of every line on every stop", () => {
    expect(
      tourLoadKg(
        [
          [
            { productId: "bag", quantity: 4 },
            { productId: "crate", quantity: 2 },
          ],
          [{ productId: "dough", quantity: 3 }],
        ],
        products,
      ),
    ).toBe(47);
  });

  it("is 0 for no stops", () => {
    expect(tourLoadKg([], products)).toBe(0);
  });
});

describe("loadState", () => {
  it("has nothing to compare with without a vehicle", () => {
    expect(loadState(120, null)).toMatchObject({ status: "none", overKg: 0, percent: 0 });
  });

  it("is ok below and exactly at the capacity", () => {
    expect(loadState(400, 500)).toMatchObject({ status: "ok", overKg: 0, percent: 80 });
    expect(loadState(500, 500)).toMatchObject({ status: "ok", overKg: 0, percent: 100 });
  });

  it("is over above the capacity and says by how much", () => {
    expect(loadState(800, 500)).toMatchObject({ status: "over", overKg: 300, percent: 160 });
    expect(loadState(500.5, 500)).toMatchObject({ status: "over", overKg: 0.5 });
  });
});
