import { handleRecurringCron } from "@/server/recurring-cron";

// Vercel Cron (vercel.json) calls this once a day.
export const maxDuration = 60;

/** Recurring orders: generates the orders of all running rules (NUD-149). */
export async function GET(request: Request) {
  return handleRecurringCron(request);
}
