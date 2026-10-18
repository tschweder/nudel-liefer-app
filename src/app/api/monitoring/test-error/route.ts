import { handleMonitoringTest } from "@/server/monitoring-test";

export const maxDuration = 30;

/** Forces a test error for Sentry (NUD-094). Bearer CRON_SECRET only. */
export async function GET(request: Request) {
  return handleMonitoringTest(request);
}
