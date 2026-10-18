/**
 * Sentry configuration helpers (NUD-094). Pure and dependency free: this file is imported by
 * `next.config.ts`, the CSP builder, the server hooks and the browser bundle, and none of them may
 * pull in the Sentry SDK just to find out whether it is switched on.
 */

export type ParsedDsn = {
  protocol: "http" | "https";
  publicKey: string;
  host: string;
  projectId: string;
  /** `https://o123.ingest.de.sentry.io` - what the CSP `connect-src` has to allow. */
  origin: string;
};

/**
 * Parses `https://<public key>@<host>/<project id>`. Returns null for an empty or malformed value
 * (the app then runs without Sentry instead of crashing at start).
 */
export function parseSentryDsn(dsn: string | undefined | null): ParsedDsn | null {
  const value = dsn?.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!url.username || !url.host) return null;
  const projectId = url.pathname.split("/").filter(Boolean).pop();
  if (!projectId || !/^\d+$/.test(projectId)) return null;
  return {
    protocol: url.protocol === "https:" ? "https" : "http",
    publicKey: decodeURIComponent(url.username),
    host: url.host,
    projectId,
    origin: url.origin,
  };
}

/** True when a usable DSN is configured. */
export function isSentryEnabled(dsn: string | undefined | null): boolean {
  return parseSentryDsn(dsn) !== null;
}

/** CSP source of the ingest endpoint, or null without a (valid) DSN. */
export function sentryIngestSource(dsn: string | undefined | null): string | null {
  return parseSentryDsn(dsn)?.origin ?? null;
}

/** Environment name shown in Sentry: the Vercel environment, else NODE_ENV. */
export function sentryEnvironment(env: Record<string, string | undefined>): string {
  return env.SENTRY_ENVIRONMENT?.trim() || env.VERCEL_ENV?.trim() || env.NODE_ENV || "development";
}

/** Release shown in Sentry: the git commit of the deployment (same value as `/api/health`). */
export function sentryRelease(env: Record<string, string | undefined>): string | undefined {
  return env.SENTRY_RELEASE?.trim() || env.VERCEL_GIT_COMMIT_SHA?.trim() || undefined;
}
