import { readFileSync } from "node:fs";
import path from "node:path";

import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

import { commonSecurityHeaders, cspHeader } from "./src/lib/security-headers";
import { isSentryEnabled, sentryEnvironment, sentryRelease } from "./src/lib/sentry-config";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const sentryDsn = isSentryEnabled(process.env.SENTRY_DSN) ? process.env.SENTRY_DSN!.trim() : "";

/**
 * NUD-110: `scripts/csp-script-hashes.ts write` stores the hashes of the inline scripts in the
 * prerendered shells (and the build ID of the first pass) between the two `next build` passes of
 * `pnpm build`. The hashes are inlined into the proxy bundle (`process.env.CSP_SCRIPT_HASHES`);
 * both are absent on the first pass and in development.
 */
function readCspBuildFile(): { buildId?: string; hashes: string } {
  try {
    const file = JSON.parse(
      readFileSync(path.join(process.cwd(), ".csp-script-hashes.json"), "utf8"),
    ) as { buildId?: unknown; common?: unknown; locales?: unknown };
    return {
      buildId: typeof file.buildId === "string" ? file.buildId : undefined,
      hashes: JSON.stringify({ common: file.common, locales: file.locales }),
    };
  } catch {
    return { hashes: "" };
  }
}
const cspBuildFile = readCspBuildFile();

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The build ID is part of the flight data inlined in static pages, whose script hashes the second
  // pass bakes into the proxy: both passes must use the same ID (a fresh random one per `pnpm
  // build`, because `reset` removes the file first).
  generateBuildId: async () => cspBuildFile.buildId ?? null,
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
    CSP_SCRIPT_HASHES: cspBuildFile.hashes,
  },
  async headers() {
    return [
      {
        // NUD-093: HSTS, framing, referrer and permissions policy for every response.
        source: "/:path*",
        headers: commonSecurityHeaders(),
      },
      {
        // NUD-093 / NUD-110: the CSP of everything the proxy does not see (its matcher skips API
        // routes, Next.js internals and files with an extension): no nonce, no hashes, so
        // `script-src 'self'`. Pages get their CSP, with a per-request nonce, from src/proxy.ts. The
        // policy is built from MAP_TILE_URL / S3_* / SENTRY_DSN when the server starts or builds
        // (see docs/deploy.md). Keep the pattern the exact complement of the proxy matcher.
        source: "/:path((?:api|_next|_vercel).*|.*\\..*)",
        headers: [cspHeader(process.env)],
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
        source: "/:file(offline\\.html|offline\\.js)",
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
