import { isSentryEnabled } from "./sentry-config";

/**
 * Reports an error caught by an error boundary (NUD-094). `NEXT_PUBLIC_SENTRY_DSN` is replaced at
 * build time (`next.config.ts`); when it is empty the whole branch, including the dynamic import,
 * is removed from the bundle. Errors Next.js forwarded from the server carry a `digest` and were
 * already reported there (`onRequestError`), so only client-side errors are sent from here.
 */
export function reportClientError(error: Error & { digest?: string }): void {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn || !isSentryEnabled(dsn)) return;
  if (error.digest) return;
  void import("@sentry/nextjs").then((Sentry) => Sentry.captureException(error));
}
