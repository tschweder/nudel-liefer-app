import { handleAuditRetentionCron } from "@/server/audit-retention-cron";

// Vercel Cron (vercel.json) calls this once a day; a run deletes at most 20 000 entries.
export const maxDuration = 60;

/** Audit log retention: the only delete path of the append-only log (NUD-111). */
export async function GET(request: Request) {
  return handleAuditRetentionCron(request);
}
