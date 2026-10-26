import { requireRole } from "./auth/guards";
import { getCustomerDetail, listUpcomingOrders, nextCustomerNumber } from "./customer-admin";
import { getNoteTranslations } from "./customer-notes";
import { getCustomerPhotos } from "./customer-photos";
import { countPinReviewQueue, listPinReviewQueue } from "./customer-pins";
import { listCustomers } from "./customers";
import { getDb } from "./db";
import { listParkingSpots } from "./parking-spots";
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

/** Customers whose pin still has to be checked, for the pin review queue (admin only). */
export async function pinReviewQueueQuery() {
  await requireRole("ADMIN");
  return listPinReviewQueue(getDb());
}

/** Number of customers waiting for pin review (admin only). */
export async function pinReviewCountQuery() {
  await requireRole("ADMIN");
  return countPinReviewQueue(getDb());
}

/** Active Parkplätze of one customer in display order, first = default (admin only). */
export async function parkingSpotsQuery(id: unknown) {
  await requireRole("ADMIN");
  return listParkingSpots(getDb(), id);
}
