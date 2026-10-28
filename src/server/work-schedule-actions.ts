"use server";

import { requireRole } from "./auth/guards";
import { getDb } from "./db";
import { saveWorkScheduleWith, type WorkScheduleSaveResult } from "./work-schedule";

/**
 * Admin-only: stores the working days and hours of one driver (NUD-152, D28). The role is checked
 * before the input is read; the schedule is not cached anywhere, so nothing has to be expired.
 */
export async function saveWorkScheduleAction(input: unknown): Promise<WorkScheduleSaveResult> {
  const actor = await requireRole("ADMIN");
  return saveWorkScheduleWith(getDb(), actor.id, input);
}
