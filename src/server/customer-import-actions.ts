"use server";

import { requireRole } from "./auth/guards";
import {
  commitImport,
  type CommitResult,
  previewImport,
  type PreviewResult,
} from "./customer-import";
import {
  type GeocodeBatchResult,
  geocodeCustomers,
  listCustomerIdsWithoutPin,
} from "./customer-pins";
import { getDb } from "./db";
import { getGeocoder } from "./geocoder";

/**
 * Admin-only server actions of the customer import (NUD-090). The role is checked against the
 * database before any input is read; the rows come from the browser and are validated again here.
 */

export async function previewCustomerImportAction(input: unknown): Promise<PreviewResult> {
  await requireRole("ADMIN");
  return previewImport(getDb(), input);
}

export async function commitCustomerImportAction(input: unknown): Promise<CommitResult> {
  await requireRole("ADMIN");
  return commitImport(getDb(), input);
}

/** Customers still without an Adresspunkt: the work list for the batch geocoding. */
export async function listCustomersWithoutPinAction(): Promise<string[]> {
  await requireRole("ADMIN");
  return listCustomerIdsWithoutPin(getDb());
}

/** One rate-limited batch (<= 5 customers) of Adresspunkte; the browser calls this in a loop. */
export async function geocodeCustomersAction(ids: unknown): Promise<GeocodeBatchResult> {
  await requireRole("ADMIN");
  return geocodeCustomers(getDb(), getGeocoder(), ids);
}
