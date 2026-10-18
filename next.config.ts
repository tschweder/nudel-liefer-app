import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

import { securityHeaders } from "./src/lib/security-headers";
import { isSentryEnabled, sentryEnvironment, sentryRelease } from "./src/lib/sentry-config";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const sentryDsn = isSentryEnabled(process.env.SENTRY_DSN) ? process.env.SENTRY_DSN!.trim() : "";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  cacheComponents: true,
  partialPrefetching: true,
  // NUD-094: the Sentry SDK patches Node internals at run time and must be loaded from
  // node_modules, not bundled (bundling breaks its own hooks and prints a warning at start).
  serverExternalPackages: ["@sentry/nextjs"],
  // NUD-094: the browser needs the DSN (public by design: it only allows sending events). It is
  // inlined at build time; an empty value removes the Sentry code from the client bundle.
  env: {
    NEXT_PUBLIC_SENTRY_DSN: sentryDsn,
    NEXT_PUBLIC_SENTRY_ENVIRONMENT: sentryDsn ? sentryEnvironment(process.env) : "",
    NEXT_PUBLIC_SENTRY_RELEASE: sentryDsn ? (sentryRelease(process.env) ?? "") : "",
  },
  async headers() {
    return [
      {
        // NUD-093: CSP, HSTS, framing, referrer and permissions policy for every response. The
        // CSP is built from MAP_TILE_URL / S3_* / SENTRY_DSN when the server starts or builds
        // (see docs/deploy.md).
        source: "/:path*",
        headers: securityHeaders(),
      },
      {
        // The service worker script must never be served from the HTTP cache, or an update
        // (a new precache list after a deploy) would not reach installed apps (NUD-080).
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
      {
        source: "/offline.html",
        headers: [{ key: "Cache-Control", value: "no-cache" }],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

const config = withNextIntl(nextConfig);

/**
 * NUD-094: the Sentry build plugin (source map upload) is applied ONLY when everything it needs is
 * present: a DSN, the auth token, organisation and project. Without them the app is built exactly
 * as before; error reporting still works at run time (without readable stack traces).
 */
const uploadSourceMaps = Boolean(
  sentryDsn &&
  process.env.SENTRY_AUTH_TOKEN?.trim() &&
  process.env.SENTRY_ORG?.trim() &&
  process.env.SENTRY_PROJECT?.trim(),
);

async function resolveConfig() {
  if (!uploadSourceMaps) return config;
  const { withSentryConfig } = await import("@sentry/nextjs/config");
  return withSentryConfig(config, {
    org: process.env.SENTRY_ORG!.trim(),
    project: process.env.SENTRY_PROJECT!.trim(),
    authToken: process.env.SENTRY_AUTH_TOKEN!.trim(),
    // Quiet build output unless the upload fails; no usage telemetry to Sentry about the build.
    silent: true,
    telemetry: false,
    release: { name: sentryRelease(process.env) },
    // Maps are uploaded and then removed from the build output: they must not be served.
    sourcemaps: { deleteSourcemapsAfterUpload: true },
    widenClientFileUpload: false,
    suppressOnRouterTransitionStartWarning: true,
    // No /monitoring tunnel: events go to Sentry directly (allowed in the CSP, docs/deploy.md).
    tunnelRoute: false,
  });
}

export default resolveConfig;
