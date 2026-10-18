import { handleRetentionCron } from "@/server/retention-cron";

// Vercel Cron (vercel.json) calls this once a day; a run handles at most 100 screenshots.
export const maxDuration = 60;

/** Retention: deletes order screenshots older than SCREENSHOT_RETENTION_DAYS (NUD-093). */
export async function GET(request: Request) {
  return handleRetentionCron(request);
}
