import { requireRole } from "./auth/guards";
import { getCustomerDetail, listUpcomingOrders, nextCustomerNumber } from "./customer-admin";
import { listCustomers } from "./customers";
import { getDb } from "./db";
import { getFactoryTimezone } from "./settings";

/**
 * Admin-only server reads for customers. Every read re-checks the role against the database
 * first (anonymous / driver / deactivated callers get an AuthorizationError before any query).
 */
export async function listCustomersQuery(input: unknown) {
  await requireRole("ADMIN");
  return listCustomers(getDb(), input);
}

/** Customer detail for the detail and edit pages (admin only). `null` when it does not exist. */
export async function getCustomerQuery(id: unknown) {
  await requireRole("ADMIN");
  return getCustomerDetail(getDb(), id);
}

/** Suggested number for the "new customer" form (admin only). */
export async function nextCustomerNumberQuery() {
  await requireRole("ADMIN");
  return nextCustomerNumber(getDb());
}

/** Upcoming (today and later, not cancelled) orders of one customer (admin only). */
export async function upcomingOrdersQuery(id: unknown) {
  await requireRole("ADMIN");
  return listUpcomingOrders(getDb(), id, await getFactoryTimezone());
}
