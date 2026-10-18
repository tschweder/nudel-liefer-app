import { isCronAuthorized } from "./cron-auth";
import { type DataRetentionReport, scrubExpiredDriverTexts } from "./data-retention";
import { getDb } from "./db";

export type DataRetentionCronDeps = {
  secret: string | undefined;
  run: () => Promise<DataRetentionReport>;
};

const noStore = { "Cache-Control": "no-store" };

/**
 * `GET /api/cron/data-retention` (NUD-112), run daily: removes the free text of driver problem
 * reports older than `DRIVER_TEXT_RETENTION_DAYS` (default 365). `DATA_RETENTION_MODE` defaults to
 * `dry-run` (counts only). Bearer `CRON_SECRET` like the other cron routes; fails closed without a
 * configured secret. The response and one log line carry the counts only, never a text; the run is
 * not written to the audit log (no user action, no actor, see `audit-coverage.test.ts`).
 */
export async function handleDataRetentionCron(
  request: Request,
  deps: Partial<DataRetentionCronDeps> = {},
): Promise<Response> {
  const secret = "secret" in deps ? deps.secret : process.env.CRON_SECRET;
  if (!isCronAuthorized(request.headers.get("authorization"), secret)) {
    if (!secret?.trim()) console.warn("[cron] CRON_SECRET is not set - rejecting cron requests");
    return Response.json({ error: "unauthorized" }, { status: 401, headers: noStore });
  }
  try {
    const report = await (deps.run ?? (() => scrubExpiredDriverTexts({ db: getDb() })))();
    console.info(`[data-retention] ${JSON.stringify(report)}`);
    return Response.json({ status: "ok", ...report }, { headers: noStore });
  } catch (error) {
    console.error(
      "[data-retention] run failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return Response.json({ status: "error" }, { status: 503, headers: noStore });
  }
}
