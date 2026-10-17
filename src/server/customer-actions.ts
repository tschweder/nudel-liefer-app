"use server";

import { requireRole } from "./auth/guards";
import {
  createCustomer,
  type CustomerSaveResult,
  setCustomerActive,
  updateCustomer,
} from "./customer-admin";
import { getDb } from "./db";

/**
 * Admin-only server actions for customer master data. The role is checked against the database
 * before the input is read; soft delete only (archive / reactivate).
 */

export async function createCustomerAction(input: unknown): Promise<CustomerSaveResult> {
  await requireRole("ADMIN");
  return createCustomer(getDb(), input);
}

export async function updateCustomerAction(
  id: unknown,
  input: unknown,
): Promise<CustomerSaveResult> {
  await requireRole("ADMIN");
  return updateCustomer(getDb(), id, input);
}

export async function setCustomerActiveAction(id: unknown, active: unknown) {
  await requireRole("ADMIN");
  return setCustomerActive(getDb(), id, active);
}
