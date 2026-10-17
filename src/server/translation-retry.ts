import type { PrismaClient } from "@/generated/prisma/client";
import { localizedTextSchema } from "@/lib/localized-text";

import { PENDING_SOURCES, type PendingSource } from "./translation-pending";
import { completeTranslation } from "./translator/localize";
import { type Translator, TranslatorError } from "./translator/types";

export type RetryCounts = { translated: number; failed: number; skipped: number };
export type RetryReport = RetryCounts & {
  /** Why the run ended before all pending records were looked at. */
  stoppedEarly?: "provider_error" | "time_budget";
  sources: Record<string, RetryCounts>;
};

export type RetryOptions = {
  db: PrismaClient;
  translator: Translator;
  sources?: readonly PendingSource[];
  /** Max records per source and run (default 50). */
  limit?: number;
  /** Stop starting new records after this many ms (default 45 s, below the 60 s function limit). */
  timeBudgetMs?: number;
  now?: () => Date;
};

/**
 * Background job of NUD-070: finds every `LocalizedText` flagged `pendingTranslation` in the
 * registered columns, completes the missing locales and saves them (see `completeTranslation`).
 *
 * - A provider failure (outage, quota, bad key) ends the run: the rest would fail the same way, and
 *   the next cron run tries again. Records stay pending. A refused text (`INVALID_INPUT`) only
 *   counts as failed and the run continues.
 * - Texts changed by the office after they were read are skipped, not overwritten.
 */
export async function retryPendingTranslations(options: RetryOptions): Promise<RetryReport> {
  const { db, translator } = options;
  const limit = options.limit ?? 50;
  const now = options.now ?? (() => new Date());
  const deadline = Date.now() + (options.timeBudgetMs ?? 45_000);
  const report: RetryReport = { translated: 0, failed: 0, skipped: 0, sources: {} };

  for (const source of options.sources ?? PENDING_SOURCES) {
    const counts: RetryCounts = { translated: 0, failed: 0, skipped: 0 };
    report.sources[source.name] = counts;
    if (report.stoppedEarly) continue;

    for (const row of await source.find(db, limit)) {
      if (Date.now() > deadline) {
        report.stoppedEarly = "time_budget";
        break;
      }
      const parsed = localizedTextSchema.safeParse(row.value);
      if (!parsed.success) {
        console.warn(`[translator] ${source.name} ${row.id}: pending value is not a LocalizedText`);
        counts.skipped++;
        continue;
      }
      try {
        const next = await completeTranslation(parsed.data, translator, now());
        if (await source.save(db, row.id, parsed.data, next)) counts.translated++;
        else counts.skipped++;
      } catch (error) {
        counts.failed++;
        const code = error instanceof TranslatorError ? error.code : "UNKNOWN";
        console.warn(`[translator] retry failed for ${source.name} ${row.id} (${code})`);
        if (!(error instanceof TranslatorError && error.code === "INVALID_INPUT")) {
          report.stoppedEarly = "provider_error";
          break;
        }
      }
    }
  }
  for (const c of Object.values(report.sources)) {
    report.translated += c.translated;
    report.failed += c.failed;
    report.skipped += c.skipped;
  }
  return report;
}
