import * as Sentry from "@sentry/nextjs";

import { sentryInitOptions } from "./lib/sentry-options";

/**
 * Server-side Sentry (NUD-094). Loaded by `instrumentation.ts` ONLY when `SENTRY_DSN` is a valid
 * DSN; without it this module is never imported and the app makes no Sentry network request.
 */
export function initServerSentry(dsn: string, env: Record<string, string | undefined>) {
  Sentry.init(sentryInitOptions(dsn, env));
}
