import { parseCalendarDate } from "@/domain/order";

import { requireRole } from "./auth/guards";
import { getDb } from "./db";
import { getDefaultDeliveryDate, getFactoryTimezone } from "./settings";
import { getTourPlan } from "./tour-planning";
import { getTourPrint, type TourPrint } from "./tour-print";

/**
 * Admin-only read of the planning screen. `date` is `YYYY-MM-DD`; anything else (or no value)
 * falls back to the next delivery date, so the page never fails on a bad URL. `tourId` selects
 * one of several tours of the day (NUD-099); an unknown id selects the default tour.
 */
export async function tourPlanQuery(date: unknown, tourId?: unknown) {
  await requireRole("ADMIN");
  const parsed = typeof date === "string" ? parseCalendarDate(date) : null;
  const day = parsed ?? (await getDefaultDeliveryDate());
  const plan = await getTourPlan(
    getDb(),
    day.toISOString().slice(0, 10),
    await getFactoryTimezone(),
    typeof tourId === "string" && tourId.length <= 64 ? tourId : null,
  );
  if (!plan) throw new Error("Unreachable: the date was validated");
  return plan;
}

/**
 * Admin-only read of the load sheet (NUD-091). An unknown or malformed tour id gives `null`
 * (the page answers 404); the role is checked before anything is read.
 */
export async function tourPrintQuery(tourId: unknown): Promise<TourPrint | null> {
  await requireRole("ADMIN");
  return getTourPrint(getDb(), tourId);
}
