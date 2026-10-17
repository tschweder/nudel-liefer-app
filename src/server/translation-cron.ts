import type { PrismaClient } from "@/generated/prisma/client";

import { isCronAuthorized } from "./cron-auth";
import { getDb } from "./db";
import { retryPendingTranslations, type RetryReport } from "./translation-retry";
import { getTranslator } from "./translator";
import type { Translator } from "./translator/types";

export type CronDeps = {
  secret: string | undefined;
  translator: () => Translator;
  db: () => PrismaClient;
  run: typeof retryPendingTranslations;
};

const noStore = { "Cache-Control": "no-store" };

/** Request handler of `GET /api/cron/retry-translations` (dependencies injectable for tests). */
export async function handleRetryTranslationsCron(
  request: Request,
  deps: Partial<CronDeps> = {},
): Promise<Response> {
  const secret = "secret" in deps ? deps.secret : process.env.CRON_SECRET;
  if (!isCronAuthorized(request.headers.get("authorization"), secret)) {
    if (!secret?.trim()) console.warn("[cron] CRON_SECRET is not set - rejecting cron requests");
    return Response.json({ error: "unauthorized" }, { status: 401, headers: noStore });
  }
  const translator = (deps.translator ?? getTranslator)();
  if (translator.kind === "fake") {
    // The Fake would "complete" pending texts with prefixed non-translations. Leave them pending.
    return Response.json(
      { status: "skipped", reason: "DEEPL_API_KEY is not set" },
      { headers: noStore },
    );
  }
  const report: RetryReport = await (deps.run ?? retryPendingTranslations)({
    db: (deps.db ?? getDb)(),
    translator,
  });
  return Response.json({ status: "ok", ...report }, { headers: noStore });
}
