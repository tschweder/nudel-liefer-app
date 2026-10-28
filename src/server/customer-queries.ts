import { requireRole } from "./auth/guards";
import { getCustomerAbbreviationHistory } from "./customer-abbreviation";
import { getCustomerDetail, listUpcomingOrders, nextCustomerNumber } from "./customer-admin";
import { getCustomerKeyHistory } from "./customer-key";
import { getNoteTranslations } from "./customer-notes";
import { getCustomerPhotos } from "./customer-photos";
import { countParkingQueue, listParkingQueue } from "./customer-pins";
import { listCustomers } from "./customers";
import { getDb } from "./db";
import { todayIn } from "./orders";
import { listParkingSpots } from "./parking-spots";
import { listRecurringOrders } from "./recurring-orders";
import { getFactoryTimezone } from "./settings";
import { getStorage } from "./storage";

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

/** Current photos of one customer with signed read URLs (admin only). */
export async function customerPhotosQuery(id: unknown) {
  await requireRole("ADMIN");
  return getCustomerPhotos(getDb(), getStorage(), id);
}

/** The four versions of the customer's note for the "Translations" tab (admin only). */
export async function noteTranslationsQuery(id: unknown) {
  await requireRole("ADMIN");
  return getNoteTranslations(getDb(), id);
}

/** Customers without a Parkplatz, for the Parkplatz queue (admin only). */
export async function parkingQueueQuery() {
  await requireRole("ADMIN");
  return listParkingQueue(getDb());
}

/** Number of customers without a Parkplatz (admin only). */
export async function parkingQueueCountQuery() {
  await requireRole("ADMIN");
  return countParkingQueue(getDb());
}

/** Active Parkplätze of one customer in display order, first = default (admin only). */
export async function parkingSpotsQuery(id: unknown) {
  await requireRole("ADMIN");
  return listParkingSpots(getDb(), id);
}

/** Key changes of one customer, newest first, so a corrected number can still be read (admin only). */
export async function customerKeyHistoryQuery(id: unknown) {
  await requireRole("ADMIN");
  return getCustomerKeyHistory(getDb(), id);
}

/** Recurring rules (Dauerbestellungen) of one customer (admin only, NUD-149). */
export async function recurringOrdersQuery(id: unknown) {
  await requireRole("ADMIN");
  return listRecurringOrders(getDb(), id, todayIn(await getFactoryTimezone()));
}

/** Abkürzung changes of one customer, newest first (admin only). */
export async function customerAbbreviationHistoryQuery(id: unknown) {
  await requireRole("ADMIN");
  return getCustomerAbbreviationHistory(getDb(), id);
}
