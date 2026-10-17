"use server";

import { requireRole } from "./auth/guards";
import { getDb } from "./db";
import { createAdmin, createDriver, resetDriverPin, setDriverLocale, setUserActive } from "./users";

/**
 * Admin-only server actions. Every action re-checks the role against the database first;
 * a driver / anonymous / deactivated caller gets an AuthorizationError before any input is read.
 */

export async function createDriverAction(input: unknown) {
  await requireRole("ADMIN");
  return createDriver(getDb(), input);
}

export async function createAdminAction(input: unknown) {
  await requireRole("ADMIN");
  return createAdmin(getDb(), input);
}

export async function resetDriverPinAction(id: unknown) {
  await requireRole("ADMIN");
  return resetDriverPin(getDb(), id);
}

export async function setUserActiveAction(id: unknown, active: unknown) {
  const actor = await requireRole("ADMIN");
  return setUserActive(getDb(), actor.id, id, active);
}

export async function setDriverLocaleAction(id: unknown, locale: unknown) {
  await requireRole("ADMIN");
  return setDriverLocale(getDb(), id, locale);
}
