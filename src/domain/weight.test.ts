import { describe, expect, it } from "vitest";

import { orderWeightKg, parseWeightKg } from "./weight";

const products = [
  { id: "beutel", weightKgPerUnit: 3 },
  { id: "karton", weightKgPerUnit: "10.00" },
  { id: "wantan", weightKgPerUnit: 5 },
];

describe("orderWeightKg", () => {
  it("multiplies quantity by the weight per unit and sums the lines", () => {
    expect(
      orderWeightKg(
        [
          { productId: "beutel", quantity: 22 },
          { productId: "karton", quantity: 14 },
          { productId: "wantan", quantity: 3 },
        ],
        products,
      ),
    ).toBe(66 + 140 + 15);
  });

  it("follows the weight per unit when an admin changes it", () => {
    const items = [{ productId: "karton", quantity: 4 }];
    expect(orderWeightKg(items, products)).toBe(40);
    expect(orderWeightKg(items, [{ id: "karton", weightKgPerUnit: 12.5 }])).toBe(50);
  });

  it("does not drift with fractional weights and ignores unknown products", () => {
    expect(
      orderWeightKg([{ productId: "x", quantity: 3 }], [{ id: "x", weightKgPerUnit: 0.1 }]),
    ).toBe(0.3);
    expect(orderWeightKg([{ productId: "gone", quantity: 9 }], products)).toBe(0);
    expect(orderWeightKg([], products)).toBe(0);
  });
});

describe("parseWeightKg", () => {
  it("accepts comma or point with up to two decimals", () => {
    expect(parseWeightKg("3")).toBe(3);
    expect(parseWeightKg("2,5")).toBe(2.5);
    expect(parseWeightKg(" 12.25 ")).toBe(12.25);
  });

  it("rejects zero, negatives, too many decimals and text", () => {
    for (const bad of ["0", "0,00", "-1", "1,234", "abc", "", "10000", "1e3"]) {
      expect(parseWeightKg(bad)).toBeNull();
    }
  });
});
