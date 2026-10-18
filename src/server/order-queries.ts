import { type OrderFilters, parseOrderFilters } from "@/domain/order-overview";

import { requireRole } from "./auth/guards";
import { getDb } from "./db";
import { lateOrderIdsForRows } from "./late-orders";
import {
  getDateTotals,
  getOrderDetail,
  listCustomersForFilter,
  listOrderableCustomers,
  listOrderOverview,
  todayIn,
} from "./orders";
import { getDefaultDeliveryDate, getFactoryTimezone } from "./settings";
import { getStorage } from "./storage";

/** Admin-only reads for the order pages; each re-checks the role against the database first. */

/** Active customers for the order entry customer picker (archived customers are not offered). */
export async function orderableCustomersQuery() {
  await requireRole("ADMIN");
  return listOrderableCustomers(getDb());
}

/**
 * The order overview: URL params are turned into filters (default = next delivery date), then
 * the matching rows, the totals of CONFIRMED orders per date and the customers for the filter.
 */
export async function orderOverviewQuery(
  params: Record<string, string | string[] | undefined> = {},
): Promise<{
  filters: OrderFilters;
  rows: Awaited<ReturnType<typeof listOrderOverview>>["rows"];
  truncated: boolean;
  totals: Awaited<ReturnType<typeof getDateTotals>>;
  customers: Awaited<ReturnType<typeof listCustomersForFilter>>;
}> {
  await requireRole("ADMIN");
  const filters = parseOrderFilters(params, await getDefaultDeliveryDate());
  const db = getDb();
  const [overview, totals, customers] = await Promise.all([
    listOrderOverview(db, filters),
    getDateTotals(db, filters),
    listCustomersForFilter(db),
  ]);
  const late = await lateOrderIdsForRows(db, overview.rows);
  return {
    filters,
    ...overview,
    rows: overview.rows.map((r) => (late.has(r.id) ? { ...r, late: true } : r)),
    totals,
    customers,
  };
}

/** Order detail incl. a signed screenshot URL and whether it can still be edited (admin only). */
export async function orderDetailQuery(id: unknown) {
  await requireRole("ADMIN");
  return getOrderDetail(getDb(), getStorage(), id, todayIn(await getFactoryTimezone()));
}
