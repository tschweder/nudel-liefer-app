"use server";

import { requireRole } from "./auth/guards";
import { getDb } from "./db";
import { todayIn } from "./orders";
import {
  createRecurringOrder,
  type RulePauseResult,
  type RuleSaveResult,
  setRecurringOrderActive,
  updateRecurringOrder,
} from "./recurring-orders";
import { getFactoryTimezone } from "./settings";
import { getTourService } from "./tour-service";

/**
 * Admin-only server actions for recurring orders (NUD-149, D25). The role is checked before the
 * input is read; validation, audit and orders generation happen in `recurring-orders.ts`.
 */

async function context() {
  return { today: todayIn(await getFactoryTimezone()), tours: getTourService() };
}

export async function createRecurringOrderAction(input: unknown): Promise<RuleSaveResult> {
  const actor = await requireRole("ADMIN");
  return createRecurringOrder(getDb(), actor.id, input, await context());
}

export async function updateRecurringOrderAction(
  id: unknown,
  input: unknown,
): Promise<RuleSaveResult> {
  const actor = await requireRole("ADMIN");
  return updateRecurringOrder(getDb(), actor.id, id, input, await context());
}

/** Pauses or resumes a rule (never deleted). */
export async function setRecurringOrderActiveAction(
  id: unknown,
  active: unknown,
): Promise<RulePauseResult> {
  const actor = await requireRole("ADMIN");
  return setRecurringOrderActive(getDb(), actor.id, id, active, await context());
}
