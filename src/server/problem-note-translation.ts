import { after } from "next/server";

import type { PrismaClient } from "@/generated/prisma/client";
import { localizedTextSchema } from "@/lib/localized-text";

import type { StopStatusResult } from "./stop-status";
import { stopProblemNoteSource } from "./translation-pending";
import { getTranslator } from "./translator";
import { completeTranslation } from "./translator/localize";
import { type Translator, TranslatorError } from "./translator/types";

/**
 * German translation of a driver's free-text problem note for the office (NUD-072).
 *
 * `applyStopMutation` stores a non-German note with `meta.pendingTranslation = true` inside the
 * driver's transaction and never talks to the translation provider. The translation happens
 * afterwards, outside that transaction:
 * - `scheduleProblemNoteTranslation` (called by the server action and, later, by the batch sync)
 *   runs `translateStopProblemNote` in `after()`, i.e. after the response was sent and with the
 *   serverless function kept alive until it finishes;
 * - if that fails or the function dies, the note stays pending and the cron retry job
 *   (`retryPendingTranslations`, `Stop.problemNote` is in `PENDING_SOURCES`) completes it.
 * Neither path can change the driver's result.
 */
export type ProblemNoteTranslation = "translated" | "pending" | "skipped";

export async function translateStopProblemNote(
  db: PrismaClient,
  stopId: string,
  options: { translator?: Translator; now?: Date } = {},
): Promise<ProblemNoteTranslation> {
  try {
    const stop = await db.stop.findUnique({ where: { id: stopId }, select: { problemNote: true } });
    const parsed = localizedTextSchema.safeParse(stop?.problemNote);
    if (!parsed.success || !parsed.data.meta.pendingTranslation) return "skipped";
    try {
      const next = await completeTranslation(
        parsed.data,
        options.translator ?? getTranslator(),
        options.now,
        stopProblemNoteSource.targets,
      );
      // Guarded on the version that was read: an undo or a new report in between wins.
      return (await stopProblemNoteSource.save(db, stopId, parsed.data, next))
        ? "translated"
        : "skipped";
    } catch (error) {
      const code = error instanceof TranslatorError ? error.code : "UNKNOWN";
      // The text itself is never logged.
      console.warn(`[translator] problem note translation failed (${code}); retry pending`);
      return "pending";
    }
  } catch {
    console.warn("[translator] problem note translation could not run; retry pending");
    return "pending";
  }
}

/**
 * Starts the translation after a successful "problem" mutation without delaying or failing it.
 * Replays (`replayed`) and other mutation kinds do nothing. Never throws.
 */
export function scheduleProblemNoteTranslation(
  db: PrismaClient,
  result: StopStatusResult,
  schedule: (task: () => Promise<unknown>) => void = after,
): void {
  if (!result.ok || result.replayed || result.kind !== "COMPLETE" || result.status !== "PROBLEM") {
    return;
  }
  const task = () => translateStopProblemNote(db, result.stopId);
  try {
    schedule(task);
  } catch {
    // Outside a request scope: the cron retry job picks the pending note up.
    console.warn("[translator] could not schedule the problem note translation; retry pending");
  }
}
