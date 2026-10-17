"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "./auth/guards";
import { getDb } from "./db";
import { scheduleProblemNoteTranslation } from "./problem-note-translation";
import { applyStopMutation, type StopMutationInput, type StopStatusResult } from "./stop-status";

/**
 * Server action of the driver stop screen (NUD-053): mark a stop delivered, report a problem or
 * undo within 5 minutes. DRIVER only (`requireRole` first), input validated with zod inside
 * `applyStopMutation`, idempotent by `clientMutationId`.
 */
export async function stopStatusAction(input: StopMutationInput): Promise<StopStatusResult> {
  const actor = await requireRole("DRIVER");
  const db = getDb();
  const result = await applyStopMutation(db, actor, input);
  // German version of a free-text problem note for the office: after the response, never blocks.
  scheduleProblemNoteTranslation(db, result);
  // Drops the client router cache so the stop and tour screens show the new state.
  if (result.ok) revalidatePath("/", "layout");
  return result;
}
