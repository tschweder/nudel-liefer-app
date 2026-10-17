import { describe, expect, it } from "vitest";

import {
  aggregateTotalsByDate,
  isOrderEditable,
  MAX_RANGE_DAYS,
  orderFiltersToQuery,
  parseOrderFilters,
  type TotalsOrder,
} from "./order-overview";

const order = (
  deliveryDate: string,
  status: TotalsOrder["status"],
  items: Array<[string, number]>,
): TotalsOrder => ({
  deliveryDate,
  status,
  items: items.map(([productId, quantityCents]) => ({ productId, quantityCents })),
});

describe("aggregateTotalsByDate", () => {
  it("sums the products of all confirmed orders of a date exactly", () => {
    const totals = aggregateTotalsByDate([
      order("2026-11-02", "CONFIRMED", [
        ["a", 250],
        ["b", 100],
      ]),
      order("2026-11-02", "CONFIRMED", [
        ["a", 325],
        ["c", 1000],
      ]),
      order("2026-11-02", "CONFIRMED", [["a", 10]]),
    ]);
    expect(totals).toEqual([
      {
        date: "2026-11-02",
        orderCount: 3,
        products: [
          { productId: "a", quantityCents: 585 },
          { productId: "b", quantityCents: 100 },
          { productId: "c", quantityCents: 1000 },
        ],
      },
    ]);
  });

  it("avoids floating point drift (0.1 + 0.2 style sums)", () => {
    const totals = aggregateTotalsByDate([
      order("2026-11-02", "CONFIRMED", [["a", 10]]),
      order("2026-11-02", "CONFIRMED", [["a", 20]]),
    ]);
    expect(totals[0]?.products[0]?.quantityCents).toBe(30);
  });

  it("excludes cancelled orders and drafts", () => {
    const totals = aggregateTotalsByDate([
      order("2026-11-02", "CONFIRMED", [["a", 100]]),
      order("2026-11-02", "CANCELLED", [["a", 5000]]),
      order("2026-11-02", "DRAFT", [["a", 700]]),
      order("2026-11-03", "CANCELLED", [["a", 1]]),
    ]);
    expect(totals).toEqual([
      { date: "2026-11-02", orderCount: 1, products: [{ productId: "a", quantityCents: 100 }] },
    ]);
  });

  it("keeps dates apart, sorted ascending, and omits dates without confirmed orders", () => {
    const totals = aggregateTotalsByDate([
      order("2026-11-05", "CONFIRMED", [["a", 100]]),
      order("2026-11-02", "CONFIRMED", [["a", 200]]),
      order("2026-11-03", "DRAFT", [["a", 300]]),
    ]);
    expect(totals.map((t) => [t.date, t.products[0]?.quantityCents])).toEqual([
      ["2026-11-02", 200],
      ["2026-11-05", 100],
    ]);
  });

  it("returns nothing for no orders", () => {
    expect(aggregateTotalsByDate([])).toEqual([]);
  });
});

describe("parseOrderFilters", () => {
  const next = new Date("2026-11-02T00:00:00Z");

  it("defaults to the next delivery date, all customers, statuses and sources", () => {
    expect(parseOrderFilters({}, next)).toEqual({
      from: "2026-11-02",
      to: "2026-11-02",
      customerId: null,
      status: null,
      source: null,
    });
  });

  it("reads a range, customer, status and source", () => {
    expect(
      parseOrderFilters(
        { from: "2026-11-02", to: "2026-11-06", customer: "c1", status: "DRAFT", source: "MANUAL" },
        next,
      ),
    ).toEqual({
      from: "2026-11-02",
      to: "2026-11-06",
      customerId: "c1",
      status: "DRAFT",
      source: "MANUAL",
    });
  });

  it("a single date means that day only", () => {
    expect(parseOrderFilters({ from: "2026-12-01" }, next)).toMatchObject({
      from: "2026-12-01",
      to: "2026-12-01",
    });
    expect(parseOrderFilters({ to: "2026-12-01" }, next)).toMatchObject({
      from: "2026-12-01",
      to: "2026-12-01",
    });
  });

  it("ignores unusable values instead of failing", () => {
    expect(
      parseOrderFilters(
        { from: "31.12.2026", to: "x", customer: "", status: "DELETED", source: ["MANUAL"] },
        next,
      ),
    ).toEqual({
      from: "2026-11-02",
      to: "2026-11-02",
      customerId: null,
      status: null,
      source: "MANUAL",
    });
  });

  it("collapses a reversed range and cuts one that is too long", () => {
    expect(parseOrderFilters({ from: "2026-11-10", to: "2026-11-01" }, next)).toMatchObject({
      from: "2026-11-10",
      to: "2026-11-10",
    });
    const long = parseOrderFilters({ from: "2026-01-01", to: "2027-12-31" }, next);
    const days = (Date.parse(long.to) - Date.parse(long.from)) / 86_400_000 + 1;
    expect(days).toBe(MAX_RANGE_DAYS);
  });

  it("round-trips through the query", () => {
    const filters = parseOrderFilters(
      { from: "2026-11-02", to: "2026-11-04", status: "CONFIRMED" },
      next,
    );
    expect(parseOrderFilters(orderFiltersToQuery(filters), next)).toEqual(filters);
  });
});

describe("isOrderEditable", () => {
  const today = new Date("2026-11-02T00:00:00Z");
  it("allows open orders from today on only", () => {
    expect(isOrderEditable({ status: "CONFIRMED", deliveryDate: today }, today)).toBe(true);
    expect(
      isOrderEditable({ status: "DRAFT", deliveryDate: new Date("2026-11-09T00:00:00Z") }, today),
    ).toBe(true);
    expect(
      isOrderEditable(
        { status: "CONFIRMED", deliveryDate: new Date("2026-11-01T00:00:00Z") },
        today,
      ),
    ).toBe(false);
    expect(isOrderEditable({ status: "CANCELLED", deliveryDate: today }, today)).toBe(false);
  });
});
