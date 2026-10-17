import { handleRetryTranslationsCron } from "@/server/translation-cron";

// Vercel Cron (vercel.json) calls this every 10 minutes; the work is bounded to ~45 s.
export const maxDuration = 60;

/** Retries machine translations that failed when the text was saved (NUD-070). */
export async function GET(request: Request) {
  return handleRetryTranslationsCron(request);
}
