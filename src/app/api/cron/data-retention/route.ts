import { handleDataRetentionCron } from "@/server/data-retention-cron";

// Vercel Cron (vercel.json) calls this once a day; a run scrubs at most 10 000 driver texts.
export const maxDuration = 60;

/** Driver free text retention (NUD-112). Dry-run unless DATA_RETENTION_MODE=delete. */
export async function GET(request: Request) {
  return handleDataRetentionCron(request);
}
