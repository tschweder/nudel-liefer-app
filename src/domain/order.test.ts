import { describe, expect, it } from "vitest";

import {
  centsToDecimal,
  formatCalendarDate,
  hasDuplicateProducts,
  isPastDeliveryDate,
  mergeOrderLines,
  orderInputSchema,
  orderWarnings,
  parseCalendarDate,
  parseQuantity,
  parseQuantityCents,
} from "./order";
import { nextDeliveryDate } from "./settings";

describe("parseQuantity", () => {
  it.each([
    ["5", 5],
    ["2,5", 2.5],
    ["2.5", 2.5],
    ["  0,25 ", 0.25],
    ["0.05", 0.05],
    ["12,50", 12.5],
    ["99999999.99", 99_999_999.99],
    [3, 3],
    [2.5, 2.5],
  ])("accepts %j as %d", (input, expected) => {
    expect(parseQuantity(input)).toBe(expected);
  });

  it.each([
    "",
    " ",
    "0",
    "0,00",
    "-1",
    "-2,5",
    "abc",
    "1,2,3",
    "1.000", // ambiguous thousands separator: rejected, not guessed
    "2,555",
    ",5",
    "5,",
    "1e3",
    "1 000",
    "100000000",
    NaN,
    Infinity,
    -3,
    0,
  ])("rejects %j", (input) => {
    expect(parseQuantity(input as string | number)).toBeNull();
  });

  it("keeps exact hundredths (no float drift)", () => {
    expect(parseQuantityCents("0.1")).toBe(10);
    expect(parseQuantityCents("1,15")).toBe(115);
    expect(parseQuantityCents("0")).toBe(0);
  });
});

describe("centsToDecimal", () => {
  it.each([
    [250, "2.50"],
    [5, "0.05"],
    [500, "5.00"],
    [9_999_999_999, "99999999.99"],
  ])("%d -> %s", (cents, expected) => {
    expect(centsToDecimal(cents)).toBe(expected);
  });
});

describe("mergeOrderLines (decision: same product twice is merged)", () => {
  it("adds quantities and keeps first-appearance order", () => {
    expect(
      mergeOrderLines([
        { productId: "a", quantityCents: 100 },
        { productId: "b", quantityCents: 250 },
        { productId: "a", quantityCents: 50 },
      ]),
    ).toEqual([
      { productId: "a", quantityCents: 150 },
      { productId: "b", quantityCents: 250 },
    ]);
  });

  it("returns null when the sum no longer fits Decimal(10,2)", () => {
    expect(
      mergeOrderLines([
        { productId: "a", quantityCents: 9_999_999_999 },
        { productId: "a", quantityCents: 1 },
      ]),
    ).toBeNull();
  });

  it("detects duplicates for the form hint", () => {
    expect(hasDuplicateProducts(["a", "b"])).toBe(false);
    expect(hasDuplicateProducts(["a", "b", "a"])).toBe(true);
  });
});

describe("calendar dates", () => {
  it("parses real days only", () => {
    expect(parseCalendarDate("2026-10-19")?.toISOString()).toBe("2026-10-19T00:00:00.000Z");
    expect(parseCalendarDate("2028-02-29")).not.toBeNull();
    expect(parseCalendarDate("2026-02-29")).toBeNull();
    expect(parseCalendarDate("2026-13-01")).toBeNull();
    expect(parseCalendarDate("19.10.2026")).toBeNull();
    expect(parseCalendarDate("")).toBeNull();
  });

  it("round-trips and compares days", () => {
    const d = parseCalendarDate("2026-10-19")!;
    expect(formatCalendarDate(d)).toBe("2026-10-19");
    const today = parseCalendarDate("2026-10-19")!;
    expect(isPastDeliveryDate(d, today)).toBe(false);
    expect(isPastDeliveryDate(parseCalendarDate("2026-10-18")!, today)).toBe(true);
    expect(isPastDeliveryDate(parseCalendarDate("2026-12-24")!, today)).toBe(false);
  });
});

describe("orderInputSchema", () => {
  const base = {
    customerId: "c1",
    deliveryDate: "2026-10-19",
    lines: [{ productId: "p1", quantity: "2,5" }],
  };

  it("accepts a valid order, defaults to CONFIRMED and normalises quantities", () => {
    const parsed = orderInputSchema.parse(base);
    expect(parsed.status).toBe("CONFIRMED");
    expect(parsed.internalNote).toBeNull();
    expect(parsed.deliveryDate.toISOString()).toBe("2026-10-19T00:00:00.000Z");
    expect(parsed.lines).toEqual([{ productId: "p1", quantityCents: 250 }]);
  });

  it("accepts comma and dot decimals in the same order and merges the same product", () => {
    const parsed = orderInputSchema.parse({
      ...base,
      status: "DRAFT",
      internalNote: "  Anruf 14 Uhr  ",
      lines: [
        { productId: "p1", quantity: "2,5" },
        { productId: "p2", quantity: 3 },
        { productId: "p1", quantity: "0.25" },
      ],
    });
    expect(parsed.status).toBe("DRAFT");
    expect(parsed.internalNote).toBe("Anruf 14 Uhr");
    expect(parsed.lines).toEqual([
      { productId: "p1", quantityCents: 275 },
      { productId: "p2", quantityCents: 300 },
    ]);
  });

  it("turns an empty note into null", () => {
    expect(orderInputSchema.parse({ ...base, internalNote: "   " }).internalNote).toBeNull();
    expect(orderInputSchema.parse({ ...base, internalNote: null }).internalNote).toBeNull();
  });

  it.each([
    ["no lines", { lines: [] }],
    ["missing lines", { lines: undefined }],
    ["zero quantity", { lines: [{ productId: "p1", quantity: "0" }] }],
    ["negative quantity", { lines: [{ productId: "p1", quantity: "-1" }] }],
    ["text quantity", { lines: [{ productId: "p1", quantity: "viel" }] }],
    ["three decimals", { lines: [{ productId: "p1", quantity: "1,234" }] }],
    ["empty product", { lines: [{ productId: " ", quantity: "1" }] }],
    [
      "one bad line among good ones",
      {
        lines: [
          { productId: "p1", quantity: "1" },
          { productId: "p2", quantity: "0" },
        ],
      },
    ],
    [
      "merged sum too large",
      {
        lines: [
          { productId: "p1", quantity: "99999999.99" },
          { productId: "p1", quantity: "1" },
        ],
      },
    ],
    [
      "too many lines",
      { lines: Array.from({ length: 101 }, (_, i) => ({ productId: `p${i}`, quantity: "1" })) },
    ],
    ["no customer", { customerId: "" }],
    ["bad date", { deliveryDate: "2026-02-30" }],
    ["date in other format", { deliveryDate: "19.10.2026" }],
    ["unknown status", { status: "CANCELLED" }],
    ["long note", { internalNote: "x".repeat(1001) }],
  ])("rejects: %s", (_name, override) => {
    expect(orderInputSchema.safeParse({ ...base, ...override }).success).toBe(false);
  });
});

describe("orderWarnings", () => {
  it("is empty for a routable customer without other orders", () => {
    expect(orderWarnings({ pinConfirmed: true, confirmedOrdersOnDate: 0 })).toEqual([]);
  });

  it("warns about combining into one stop", () => {
    expect(orderWarnings({ pinConfirmed: true, confirmedOrdersOnDate: 1 })).toEqual([
      "combined_stop",
    ]);
  });

  it("warns about an unconfirmed pin and can show both", () => {
    expect(orderWarnings({ pinConfirmed: false, confirmedOrdersOnDate: 0 })).toEqual([
      "pin_unconfirmed",
    ]);
    expect(orderWarnings({ pinConfirmed: false, confirmedOrdersOnDate: 2 })).toEqual([
      "combined_stop",
      "pin_unconfirmed",
    ]);
  });
});

describe("default delivery date of the order form", () => {
  it("is the next delivery weekday, formatted for the date field, and always accepted", () => {
    const now = new Date("2026-10-16T08:00:00Z"); // Friday in Vienna
    const settings = { timezone: "Europe/Vienna", deliveryWeekdays: [1, 2, 3, 4, 5] };
    const formatted = formatCalendarDate(nextDeliveryDate(now, settings));
    expect(formatted).toBe("2026-10-19"); // Monday
    const parsed = parseCalendarDate(formatted)!;
    expect(isPastDeliveryDate(parsed, parseCalendarDate("2026-10-16")!)).toBe(false);
    expect(formatCalendarDate(nextDeliveryDate(now, { ...settings, deliveryWeekdays: [3] }))).toBe(
      "2026-10-21",
    ); // changed weekdays change the default
    expect(
      orderInputSchema.safeParse({
        customerId: "c",
        deliveryDate: formatted,
        lines: [{ productId: "p", quantity: "1" }],
      }).success,
    ).toBe(true);
  });
});
