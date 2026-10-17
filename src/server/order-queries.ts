import { requireRole } from "./auth/guards";
import { getDb } from "./db";
import { listOrderableCustomers, listOrderOverview, todayIn } from "./orders";
import { getFactoryTimezone } from "./settings";

/** Admin-only reads for order entry; each re-checks the role against the database first. */

/** Active customers for the order entry customer picker (archived customers are not offered). */
export async function orderableCustomersQuery() {
  await requireRole("ADMIN");
  return listOrderableCustomers(getDb());
}

/** Minimal list of upcoming orders (NUD-032 replaces the page that shows it). */
export async function orderOverviewQuery() {
  await requireRole("ADMIN");
  return listOrderOverview(getDb(), todayIn(await getFactoryTimezone()));
}
