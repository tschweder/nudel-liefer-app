import { sentryEnvironment, sentryRelease } from "./sentry-config";
import { beforeSend, scrubBreadcrumb } from "./sentry-scrub";

/**
 * `Sentry.init` options shared by the server and the browser (NUD-094). Errors only: no tracing,
 * no session replay, no profiling, no user feedback widget - so nothing but the (scrubbed) error
 * event is ever sent, and no extra blob/worker/CSP surface appears in the driver app.
 */
export function sentryInitOptions(dsn: string, env: Record<string, string | undefined>) {
  return {
    dsn,
    environment: sentryEnvironment(env),
    release: sentryRelease(env),
    // No IP addresses, no cookies and headers by default (the scrubber removes the rest).
    sendDefaultPii: false,
    // Tracing stays off unless a sample rate is set: do not set one without a privacy review.
    sendClientReports: false,
    maxBreadcrumbs: 30,
    normalizeDepth: 3,
    beforeSend,
    beforeBreadcrumb: scrubBreadcrumb,
  };
}
