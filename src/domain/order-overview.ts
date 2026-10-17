import { centsToDecimal, formatCalendarDate, parseCalendarDate } from "./order";

/**
 * Pure rules of the order overview (NUD-032): per-date product totals and the URL filters.
 * No framework or database imports.
 */

export type OrderStatusValue = "DRAFT" | "CONFIRMED" | "CANCELLED";
export type OrderSourceValue = "MANUAL" | "SCREENSHOT";

export const ORDER_STATUSES: readonly OrderStatusValue[] = ["DRAFT", "CONFIRMED", "CANCELLED"];
export const ORDER_SOURCES: readonly OrderSourceValue[] = ["MANUAL", "SCREENSHOT"];

/** The overview shows at most this many days at once (keeps the list and the totals readable). */
export const MAX_RANGE_DAYS = 62;
const DAY_MS = 86_400_000;

export type TotalsOrder = {
  /** `YYYY-MM-DD` */
  deliveryDate: string;
  status: OrderStatusValue;
  items: ReadonlyArray<{ productId: string; quantityCents: number }>;
};

export type DateTotals = {
  /** `YYYY-MM-DD` */
  date: string;
  /** Number of CONFIRMED orders that make up the totals. */
  orderCount: number;
  products: Array<{ productId: string; quantityCents: number }>;
};

/**
 * Sum per product for each delivery date, from CONFIRMED orders only: drafts and cancelled orders
 * never count (they are neither produced nor delivered). Quantities are exact hundredths.
 * Dates ascending, products by id; dates without any confirmed order are omitted.
 */
export function aggregateTotalsByDate(orders: readonly TotalsOrder[]): DateTotals[] {
  const byDate = new Map<string, { orderCount: number; sums: Map<string, number> }>();
  for (const order of orders) {
    if (order.status !== "CONFIRMED") continue;
    const day = byDate.get(order.deliveryDate) ?? { orderCount: 0, sums: new Map() };
    day.orderCount += 1;
    for (const item of order.items) {
      day.sums.set(item.productId, (day.sums.get(item.productId) ?? 0) + item.quantityCents);
    }
    byDate.set(order.deliveryDate, day);
  }
  return [...byDate]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, day]) => ({
      date,
      orderCount: day.orderCount,
      products: [...day.sums]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([productId, quantityCents]) => ({ productId, quantityCents })),
    }));
}

/** Total in hundredths to the plain string the formatters expect (`"12.50"`). */
export const totalToDecimal = centsToDecimal;

export type OrderFilters = {
  /** `YYYY-MM-DD`, inclusive */
  from: string;
  /** `YYYY-MM-DD`, inclusive */
  to: string;
  customerId: string | null;
  status: OrderStatusValue | null;
  source: OrderSourceValue | null;
};

type RawParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value)?.trim() ?? "";

/**
 * URL search params to filters. Nothing here can fail: anything unusable falls back to the
 * default (the next delivery date, all statuses, all sources, all customers). A range with
 * `to` before `from` collapses to `from`; a range longer than `MAX_RANGE_DAYS` is cut.
 */
export function parseOrderFilters(params: RawParams, defaultDate: Date): OrderFilters {
  const fromDate = parseCalendarDate(first(params.from));
  const toDate = parseCalendarDate(first(params.to));
  const start = fromDate ?? toDate ?? defaultDate;
  let end = toDate ?? start;
  if (end.getTime() < start.getTime()) end = start;
  const limit = new Date(start.getTime() + (MAX_RANGE_DAYS - 1) * DAY_MS);
  if (end.getTime() > limit.getTime()) end = limit;

  const customerId = first(params.customer);
  const status = first(params.status);
  const source = first(params.source);
  return {
    from: formatCalendarDate(start),
    to: formatCalendarDate(end),
    customerId: customerId && customerId.length <= 64 ? customerId : null,
    status: ORDER_STATUSES.find((s) => s === status) ?? null,
    source: ORDER_SOURCES.find((s) => s === source) ?? null,
  };
}

/** Filters back to URL query values (only non-default parts besides the dates). */
export function orderFiltersToQuery(filters: OrderFilters): Record<string, string> {
  const query: Record<string, string> = { from: filters.from, to: filters.to };
  if (filters.customerId) query.customer = filters.customerId;
  if (filters.status) query.status = filters.status;
  if (filters.source) query.source = filters.source;
  return query;
}

/** Orders can be edited or cancelled only while their delivery day is today or later. */
export function isOrderEditable(
  order: { status: OrderStatusValue; deliveryDate: Date },
  today: Date,
): boolean {
  return order.status !== "CANCELLED" && order.deliveryDate.getTime() >= today.getTime();
}
