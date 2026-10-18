import type { Instrumentation } from "next";

import { isSentryEnabled } from "./lib/sentry-config";

/**
 * Next.js instrumentation hook (NUD-094). With no `SENTRY_DSN` both functions return at once and
 * the Sentry SDK is never loaded (zero overhead, no network). The DSN is read at run time on the
 * server; for the browser it is baked in at build time (see `next.config.ts`).
 */
export async function register() {
  const dsn = process.env.SENTRY_DSN;
  if (!isSentryEnabled(dsn) || process.env.NEXT_RUNTIME !== "nodejs") return;
  const { initServerSentry } = await import("./sentry.server.config");
  initServerSentry(dsn!.trim(), process.env);
}

/** Server-side errors of pages, server actions and route handlers (also the ones Next hides). */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (!isSentryEnabled(process.env.SENTRY_DSN)) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(error, request, context);
};
