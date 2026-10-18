import { type AuditPurgeReport,purgeExpiredAuditEntries } from "./audit-retention";
import { isCronAuthorized } from "./cron-auth";
import { getDb } from "./db";

export type AuditRetentionCronDeps = {
  secret: string | undefined;
  run: () => Promise<AuditPurgeReport>;
};

const noStore = { "Cache-Control": "no-store" };

/**
 * `GET /api/cron/audit-retention` (NUD-111), run daily: deletes audit entries older than
 * `AUDIT_RETENTION_DAYS` (default 730, floor 90). Bearer `CRON_SECRET` like the other cron
 * routes; fails closed without a configured secret. The response and one log line carry the
 * counts; the run itself is not written to the audit log.
 */
export async function handleAuditRetentionCron(
  request: Request,
  deps: Partial<AuditRetentionCronDeps> = {},
): Promise<Response> {
  const secret = "secret" in deps ? deps.secret : process.env.CRON_SECRET;
  if (!isCronAuthorized(request.headers.get("authorization"), secret)) {
    if (!secret?.trim()) console.warn("[cron] CRON_SECRET is not set - rejecting cron requests");
    return Response.json({ error: "unauthorized" }, { status: 401, headers: noStore });
  }
  try {
    const report = await (deps.run ?? (() => purgeExpiredAuditEntries({ db: getDb() })))();
    console.info(`[audit-retention] ${JSON.stringify(report)}`);
    return Response.json({ status: "ok", ...report }, { headers: noStore });
  } catch (error) {
    console.error(
      "[audit-retention] run failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return Response.json({ status: "error" }, { status: 503, headers: noStore });
  }
}
