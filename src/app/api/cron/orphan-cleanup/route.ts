import { handleOrphanCleanupCron } from "@/server/orphan-cleanup-cron";

// Vercel Cron (vercel.json) calls this once a week.
export const maxDuration = 60;

/** Orphaned storage objects: report (default) or delete (NUD-094). */
export async function GET(request: Request) {
  return handleOrphanCleanupCron(request);
}
