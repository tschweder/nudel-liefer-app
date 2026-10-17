import { parseCalendarDate } from "@/domain/order";

import { requireRole } from "./auth/guards";
import { getDb } from "./db";
import { getDefaultDeliveryDate, getFactoryTimezone } from "./settings";
import { getTourPlan } from "./tour-planning";

/**
 * Admin-only read of the planning screen. `date` is `YYYY-MM-DD`; anything else (or no value)
 * falls back to the next delivery date, so the page never fails on a bad URL.
 */
export async function tourPlanQuery(date: unknown) {
  await requireRole("ADMIN");
  const parsed = typeof date === "string" ? parseCalendarDate(date) : null;
  const day = parsed ?? (await getDefaultDeliveryDate());
  const plan = await getTourPlan(
    getDb(),
    day.toISOString().slice(0, 10),
    await getFactoryTimezone(),
  );
  if (!plan) throw new Error("Unreachable: the date was validated");
  return plan;
}
