import { Prisma, type PrismaClient } from "@/generated/prisma/client";

/** Audit entries are kept this long unless `AUDIT_RETENTION_DAYS` says otherwise (about 24 months). */
export const DEFAULT_AUDIT_RETENTION_DAYS = 730;
/**
 * Lowest accepted value. The trigger function enforces the same floor in SQL
 * (migration `20261018130000_audit_log_retention`), so even a bug here cannot wipe recent history.
 */
export const MIN_AUDIT_RETENTION_DAYS = 90;
export const MAX_AUDIT_RETENTION_DAYS = 36500;
/** Rows deleted per transaction and the most batches per run (20 000 rows; the rest follows next run). */
export const AUDIT_PURGE_BATCH_SIZE = 1000;
export const AUDIT_PURGE_MAX_BATCHES = 20;

/**
 * `AUDIT_RETENTION_DAYS` as whole days (90..36500). Unset, empty, non-numeric or out-of-range
 * values fall back to 730: a typo must never delete history that should stay.
 */
export function auditRetentionDays(raw: string | undefined = process.env.AUDIT_RETENTION_DAYS) {
  const value = raw?.trim();
  if (!value || !/^\d+$/.test(value)) return DEFAULT_AUDIT_RETENTION_DAYS;
  const days = Number(value);
  if (days < MIN_AUDIT_RETENTION_DAYS || days > MAX_AUDIT_RETENTION_DAYS) {
    return DEFAULT_AUDIT_RETENTION_DAYS;
  }
  return days;
}

export type AuditPurgeReport = {
  retentionDays: number;
  cutoff: string;
  deleted: number;
  batches: number;
  /** More expired rows may exist than this run handled. */
  more: boolean;
};

type Db = Pick<PrismaClient, "$transaction">;

/**
 * The one and only delete path of the audit log (NUD-111). Each batch runs in its own transaction
 * that sets the transaction-local `nudel.audit_retention = 'on'`, which the append-only trigger
 * honours for rows older than 90 days. `retentionDays` below the floor is rejected, not clamped.
 */
export async function purgeExpiredAuditEntries(deps: {
  db: Db;
  now?: Date;
  retentionDays?: number;
  batchSize?: number;
  maxBatches?: number;
}): Promise<AuditPurgeReport> {
  const retentionDays = deps.retentionDays ?? auditRetentionDays();
  if (!Number.isInteger(retentionDays) || retentionDays < MIN_AUDIT_RETENTION_DAYS) {
    throw new Error(`audit retention below ${MIN_AUDIT_RETENTION_DAYS} days refused`);
  }
  const batchSize = deps.batchSize ?? AUDIT_PURGE_BATCH_SIZE;
  const maxBatches = deps.maxBatches ?? AUDIT_PURGE_MAX_BATCHES;
  const now = deps.now ?? new Date();
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

  let deleted = 0;
  let batches = 0;
  let more = false;
  while (batches < maxBatches) {
    const count = await deps.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('nudel.audit_retention', 'on', true)`;
      return tx.$executeRaw(
        Prisma.sql`DELETE FROM "AuditLog" WHERE "id" IN (SELECT "id" FROM "AuditLog" WHERE "createdAt" < ${cutoff} ORDER BY "createdAt" ASC LIMIT ${batchSize})`,
      );
    });
    batches += 1;
    deleted += count;
    if (count < batchSize) break;
    if (batches === maxBatches) more = true;
  }
  return { retentionDays, cutoff: cutoff.toISOString(), deleted, batches, more };
}
