"use server";

import { requireRole } from "./auth/guards";
import {
  createCustomer,
  type CustomerSaveResult,
  setCustomerActive,
  updateCustomer,
} from "./customer-admin";
import { addCustomerPhoto } from "./customer-photos";
import { getDb } from "./db";
import { getStorage } from "./storage";

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

/**
 * Attaches an already uploaded object as the customer's current STORE / PARKING photo (the old
 * one stays as history). Admin only; drivers photograph in NUD-083 through their own action.
 */
export async function addCustomerPhotoAction(input: unknown) {
  const actor = await requireRole("ADMIN");
  return addCustomerPhoto(getDb(), getStorage(), actor.id, input);
}
