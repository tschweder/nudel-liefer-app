import { isCronAuthorized } from "./cron-auth";
import { getDb } from "./db";
import { cleanupOrphanedObjects, type OrphanReport } from "./orphan-cleanup";
import { getStorage } from "./storage";

export type OrphanCronDeps = {
  secret: string | undefined;
  run: () => Promise<OrphanReport>;
};

const noStore = { "Cache-Control": "no-store" };

/**
 * `GET /api/cron/orphan-cleanup` (NUD-094), weekly. Bearer `CRON_SECRET` like the other cron
 * routes; fails closed. The mode (`ORPHAN_CLEANUP_MODE`, default dry-run) and the grace period
 * come from the environment; the answer and one log line carry the report.
 */
export async function handleOrphanCleanupCron(
  request: Request,
  deps: Partial<OrphanCronDeps> = {},
): Promise<Response> {
  const secret = "secret" in deps ? deps.secret : process.env.CRON_SECRET;
  if (!isCronAuthorized(request.headers.get("authorization"), secret)) {
    if (!secret?.trim()) console.warn("[cron] CRON_SECRET is not set - rejecting cron requests");
    return Response.json({ error: "unauthorized" }, { status: 401, headers: noStore });
  }
  try {
    const report = await (
      deps.run ?? (() => cleanupOrphanedObjects({ db: getDb(), storage: getStorage() }))
    )();
    console.info(`[orphan-cleanup] ${JSON.stringify(report)}`);
    return Response.json(
      { status: report.failed > 0 ? "partial" : "ok", ...report },
      { headers: noStore },
    );
  } catch (error) {
    // Typically the storage listing failed. Nothing was deleted in that case.
    console.error("[orphan-cleanup] run failed:", error);
    return Response.json({ status: "error" }, { status: 503, headers: noStore });
  }
}
