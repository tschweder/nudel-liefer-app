import type { PrismaClient } from "@/generated/prisma/client";

import { purgeLoginAttempts } from "./auth/rate-limit";
import { isCronAuthorized } from "./cron-auth";
import { getDb } from "./db";
import { purgeExpiredScreenshots, type PurgeReport } from "./screenshot-retention";
import { getStorage } from "./storage";
import type { Storage } from "./storage/types";

export type RetentionCronDeps = {
  secret: string | undefined;
  db: () => PrismaClient;
  storage: () => Storage;
  run: typeof purgeExpiredScreenshots;
  purgeLogins: typeof purgeLoginAttempts;
};

const noStore = { "Cache-Control": "no-store" };

/**
 * Request handler of `GET /api/cron/retention` (NUD-093), run daily: deletes order screenshots
 * older than `SCREENSHOT_RETENTION_DAYS` (default 180; storage object and row) and failed-login
 * rows older than 24 h. `Authorization: Bearer $CRON_SECRET` like the other cron route; fails
 * closed without a configured secret. Dependencies injectable for tests.
 */
export async function handleRetentionCron(
  request: Request,
  deps: Partial<RetentionCronDeps> = {},
): Promise<Response> {
  const secret = "secret" in deps ? deps.secret : process.env.CRON_SECRET;
  if (!isCronAuthorized(request.headers.get("authorization"), secret)) {
    if (!secret?.trim()) console.warn("[cron] CRON_SECRET is not set - rejecting cron requests");
    return Response.json({ error: "unauthorized" }, { status: 401, headers: noStore });
  }
  const db = (deps.db ?? getDb)();
  const report: PurgeReport = await (deps.run ?? purgeExpiredScreenshots)({
    db,
    storage: (deps.storage ?? getStorage)(),
  });
  // Independent of the screenshots: a storage outage must not keep IP addresses in the table.
  const loginAttemptsDeleted = await (deps.purgeLogins ?? purgeLoginAttempts)(db);
  return Response.json(
    { status: report.failed > 0 ? "partial" : "ok", ...report, loginAttemptsDeleted },
    { headers: noStore },
  );
}
