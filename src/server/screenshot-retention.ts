import type { PrismaClient } from "@/generated/prisma/client";

import type { Storage } from "./storage/types";

/** Order screenshots (WhatsApp / WeChat chats may contain personal data) are kept this long. */
export const DEFAULT_SCREENSHOT_RETENTION_DAYS = 180;
export const MIN_SCREENSHOT_RETENTION_DAYS = 1;
export const MAX_SCREENSHOT_RETENTION_DAYS = 3650;
/** Rows handled per run; the daily cron catches up over several days after a long outage. */
export const PURGE_BATCH_SIZE = 100;

/**
 * `SCREENSHOT_RETENTION_DAYS` as a whole number of days (1..3650). Unset, empty or invalid values
 * fall back to 180: a typo must never switch the retention off or delete everything.
 */
export function screenshotRetentionDays(
  raw: string | undefined = process.env.SCREENSHOT_RETENTION_DAYS,
) {
  const value = raw?.trim();
  if (!value || !/^\d+$/.test(value)) return DEFAULT_SCREENSHOT_RETENTION_DAYS;
  const days = Number(value);
  if (days < MIN_SCREENSHOT_RETENTION_DAYS || days > MAX_SCREENSHOT_RETENTION_DAYS) {
    return DEFAULT_SCREENSHOT_RETENTION_DAYS;
  }
  return days;
}

export type PurgeReport = {
  retentionDays: number;
  cutoff: string;
  /** Expired screenshots looked at in this run (at most the batch size). */
  examined: number;
  /** Storage object AND database row removed. */
  deleted: number;
  /** Left in place for the next run (storage or database error). */
  failed: number;
  /** More expired rows exist than this run handled. */
  more: boolean;
};

type Db = Pick<PrismaClient, "screenshot">;

/**
 * Deletes screenshots older than the retention period: the storage object first, then the row.
 * That order is deliberate. If the process dies in between, the row still points at a missing
 * object (harmless, the next run deletes the row; deleting a missing key is not an error). The
 * other order could leave an object nobody knows about any more and nothing would ever delete it.
 * Orders keep existing: `Order.screenshotId` is set to NULL by the foreign key (`onDelete: SetNull`).
 * A failure on one screenshot never stops the others.
 */
export async function purgeExpiredScreenshots(deps: {
  db: Db;
  storage: Storage;
  now?: Date;
  retentionDays?: number;
  batchSize?: number;
}): Promise<PurgeReport> {
  const { db, storage } = deps;
  const retentionDays = deps.retentionDays ?? screenshotRetentionDays();
  const batchSize = deps.batchSize ?? PURGE_BATCH_SIZE;
  const now = deps.now ?? new Date();
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

  const expired = await db.screenshot.findMany({
    where: { createdAt: { lt: cutoff } },
    orderBy: { createdAt: "asc" },
    take: batchSize + 1,
    select: { id: true, storageKey: true },
  });
  const batch = expired.slice(0, batchSize);

  let deleted = 0;
  let failed = 0;
  for (const shot of batch) {
    try {
      await storage.delete(shot.storageKey);
      await db.screenshot.deleteMany({ where: { id: shot.id } });
      deleted += 1;
    } catch (error) {
      failed += 1;
      console.error(`[retention] screenshot ${shot.id} not purged:`, error);
    }
  }
  return {
    retentionDays,
    cutoff: cutoff.toISOString(),
    examined: batch.length,
    deleted,
    failed,
    more: expired.length > batchSize,
  };
}
