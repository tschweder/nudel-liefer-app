import { Prisma, type PrismaClient } from "@/generated/prisma/client";

/**
 * Driver free text (`Stop.problemNote`) is kept this long after the stop was completed unless
 * `DRIVER_TEXT_RETENTION_DAYS` says otherwise (NUD-112, `docs/privacy.md` section 6).
 */
export const DEFAULT_DRIVER_TEXT_RETENTION_DAYS = 365;
export const MIN_DRIVER_TEXT_RETENTION_DAYS = 30;
export const MAX_DRIVER_TEXT_RETENTION_DAYS = 3650;
/** Rows handled per transaction and the most batches per run (the rest follows the next day). */
export const DATA_RETENTION_BATCH_SIZE = 500;
export const DATA_RETENTION_MAX_BATCHES = 20;

export const DATA_RETENTION_MODES = ["off", "dry-run", "delete"] as const;
export type DataRetentionMode = (typeof DATA_RETENTION_MODES)[number];

/**
 * `DATA_RETENTION_MODE`: `off` | `dry-run` | `delete`; anything else, also unset, is `dry-run`
 * (counts only, nothing is changed). Same convention as `ORPHAN_CLEANUP_MODE`.
 */
export function dataRetentionMode(
  raw: string | undefined = process.env.DATA_RETENTION_MODE,
): DataRetentionMode {
  const value = raw?.trim().toLowerCase();
  return (DATA_RETENTION_MODES as readonly string[]).includes(value ?? "")
    ? (value as DataRetentionMode)
    : "dry-run";
}

/**
 * `DRIVER_TEXT_RETENTION_DAYS` as whole days (30..3650). Unset, empty, non-numeric or out-of-range
 * values fall back to 365: a typo must never scrub texts earlier than intended.
 */
export function driverTextRetentionDays(
  raw: string | undefined = process.env.DRIVER_TEXT_RETENTION_DAYS,
): number {
  const value = raw?.trim();
  if (!value || !/^\d+$/.test(value)) return DEFAULT_DRIVER_TEXT_RETENTION_DAYS;
  const days = Number(value);
  if (days < MIN_DRIVER_TEXT_RETENTION_DAYS || days > MAX_DRIVER_TEXT_RETENTION_DAYS) {
    return DEFAULT_DRIVER_TEXT_RETENTION_DAYS;
  }
  return days;
}

export type DataRetentionReport = {
  mode: DataRetentionMode;
  retentionDays: number;
  cutoff: string;
  /** Driver texts older than the period (dry-run: counted; delete: found in this run). */
  expired: number;
  /** Texts actually removed (always 0 outside `delete`). */
  scrubbed: number;
  batches: number;
  /** More expired texts exist than this run handled. */
  more: boolean;
};

type Db = Pick<PrismaClient, "stop">;

/**
 * Removes the free text of old driver problem reports (NUD-112). Only `Stop.problemNote` is set
 * to NULL, and only on stops completed before the cutoff: the structured `problemReason`, the
 * status, times, quantities and the rest of the stop, tour and orders stay, so history views
 * and quantity disputes keep working (they show a stop with a reason and no note).
 * The whole `LocalizedText` goes at once: the driver's original, the German translation and the
 * `pendingTranslation` marker. A note still waiting for its translation is scrubbed too; the
 * retry job (`PENDING_SOURCES`) finds no pending marker any more and its guarded save is a no-op.
 *
 * Idempotent (a scrubbed stop no longer matches), batched, and `dry-run` (the default) only counts.
 * Orders, tours and stops themselves are never deleted: they are transactional history, see
 * `docs/privacy.md` section 6.
 */
export async function scrubExpiredDriverTexts(deps: {
  db: Db;
  now?: Date;
  mode?: DataRetentionMode;
  retentionDays?: number;
  batchSize?: number;
  maxBatches?: number;
}): Promise<DataRetentionReport> {
  const mode = deps.mode ?? dataRetentionMode();
  const retentionDays = deps.retentionDays ?? driverTextRetentionDays();
  if (!Number.isInteger(retentionDays) || retentionDays < MIN_DRIVER_TEXT_RETENTION_DAYS) {
    throw new Error(`driver text retention below ${MIN_DRIVER_TEXT_RETENTION_DAYS} days refused`);
  }
  const batchSize = deps.batchSize ?? DATA_RETENTION_BATCH_SIZE;
  const maxBatches = deps.maxBatches ?? DATA_RETENTION_MAX_BATCHES;
  const now = deps.now ?? new Date();
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  const base = { mode, retentionDays, cutoff: cutoff.toISOString() };
  const expiredWhere = {
    completedAt: { lt: cutoff },
    problemNote: { not: Prisma.DbNull },
  } satisfies Prisma.StopWhereInput;

  if (mode === "off") return { ...base, expired: 0, scrubbed: 0, batches: 0, more: false };
  if (mode === "dry-run") {
    const expired = await deps.db.stop.count({ where: expiredWhere });
    return { ...base, expired, scrubbed: 0, batches: 0, more: false };
  }

  let scrubbed = 0;
  let batches = 0;
  let more = false;
  while (batches < maxBatches) {
    const rows = await deps.db.stop.findMany({
      where: expiredWhere,
      orderBy: { completedAt: "asc" },
      take: batchSize,
      select: { id: true },
    });
    if (rows.length === 0) break;
    // The condition is repeated so a stop that changed since the read (an undo, a re-scrub) is
    // never touched.
    const { count } = await deps.db.stop.updateMany({
      where: { id: { in: rows.map((r) => r.id) }, ...expiredWhere },
      data: { problemNote: Prisma.DbNull },
    });
    batches += 1;
    scrubbed += count;
    if (rows.length < batchSize) break;
    if (batches === maxBatches) more = true;
  }
  return { ...base, expired: scrubbed, scrubbed, batches, more };
}
