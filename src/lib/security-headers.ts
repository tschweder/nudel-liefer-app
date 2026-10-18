import { DEV_TILE_URL, isTileCacheEnabled } from "./map-config";
import { sentryIngestSource } from "./sentry-config";

type Env = Record<string, string | undefined>;
export type HeaderEntry = { key: string; value: string };

/**
 * Host source (CSP syntax) of the map tile server from `MAP_TILE_URL`. A subdomain placeholder
 * (`https://{s}.tile.example.org/...`) becomes a wildcard (`https://*.tile.example.org`).
 * Returns null when the URL has no usable origin.
 */
export function tileSource(tileUrl: string | undefined): string | null {
  const match = /^(https?):\/\/([^/?#]+)/i.exec((tileUrl?.trim() || DEV_TILE_URL).trim());
  if (!match) return null;
  const scheme = match[1]!.toLowerCase();
  const labels = match[2]!.split(".");
  const placeholder = labels.findIndex((label) => label.includes("{"));
  if (placeholder === -1) return `${scheme}://${match[2]!.toLowerCase()}`;
  const rest = labels.slice(placeholder + 1);
  return rest.length > 0 ? `${scheme}://*.${rest.join(".").toLowerCase()}` : null;
}

/**
 * Origins the browser talks to for photos and screenshots: it uploads (PUT) to and shows images
 * (GET) from presigned URLs on the object store (MinIO / Cloudflare R2 `S3_ENDPOINT`, or AWS S3).
 */
export function storageSources(env: Env): string[] {
  const endpoint = env.S3_ENDPOINT?.trim();
  if (endpoint) {
    try {
      return [new URL(endpoint).origin];
    } catch {
      return [];
    }
  }
  const bucket = env.S3_BUCKET?.trim();
  const region = env.S3_REGION?.trim();
  if (bucket && region) {
    return [`https://${bucket}.s3.${region}.amazonaws.com`, `https://s3.${region}.amazonaws.com`];
  }
  return [];
}

/**
 * Content-Security-Policy (NUD-093).
 *
 * `script-src` keeps `'unsafe-inline'`: Next.js streams its hydration data in inline `<script>`
 * tags and the app uses cache components / partial prerendering, whose prebuilt shells cannot carry
 * a per-request nonce (Next.js documents nonces as incompatible with PPR). Everything else is
 * locked down (`object-src`, `base-uri`, `frame-ancestors`, `form-action`, per-type `*-src`).
 * `style-src` keeps `'unsafe-inline'` because Leaflet positions its panes and markers with inline
 * styles. Development additionally needs `'unsafe-eval'` and websockets for HMR.
 */
export function buildCsp(env: Env, options: { dev?: boolean } = {}): string {
  const dev = options.dev ?? env.NODE_ENV !== "production";
  const storage = storageSources(env);
  const tiles = tileSource(env.MAP_TILE_URL);
  // NUD-094: the browser SDK posts error events straight to the DSN's ingest host. Nothing is
  // allowed without a (valid) SENTRY_DSN.
  const sentry = sentryIngestSource(env.SENTRY_DSN);
  const directives: Array<[string, string[]]> = [
    ["default-src", ["'self'"]],
    ["script-src", ["'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : [])]],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:", ...storage, ...(tiles ? [tiles] : [])]],
    ["font-src", ["'self'", "data:"]],
    [
      "connect-src",
      [
        "'self'",
        ...storage,
        ...(sentry ? [sentry] : []),
        // NUD-108: with MAP_TILE_CACHE the service worker fetches the tiles itself; that fetch is
        // checked against connect-src (not img-src).
        ...(tiles && isTileCacheEnabled(env) ? [tiles] : []),
        ...(dev ? ["ws:", "wss:"] : []),
      ],
    ],
    ["worker-src", ["'self'"]],
    ["manifest-src", ["'self'"]],
    ["media-src", ["'self'"]],
    ["object-src", ["'none'"]],
    ["frame-src", ["'none'"]],
    ["frame-ancestors", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    // Violations end up in the server log (one line each); essential for a report-only rollout.
    ["report-uri", ["/api/csp-report"]],
  ];
  return directives.map(([name, values]) => `${name} ${values.join(" ")}`).join("; ");
}

/**
 * Response headers for every route. `CSP_REPORT_ONLY=true` sends the policy as
 * `Content-Security-Policy-Report-Only` (violations are logged in the browser console, nothing is
 * blocked) - the switch for rolling out a changed policy.
 */
export function securityHeaders(env: Env = process.env): HeaderEntry[] {
  const reportOnly = env.CSP_REPORT_ONLY?.trim().toLowerCase() === "true";
  return [
    {
      key: reportOnly ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy",
      value: buildCsp(env),
    },
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    // Origin only to other sites: the tile provider sees our host (allowed-origins check of the
    // API key) but never a path with ids.
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // Driver photos use <input capture>, which needs no permission; camera stays allowed for our
    // own origin only (no embedded frames exist). No GPS tracking (D19), no microphone, no payment.
    {
      key: "Permissions-Policy",
      value:
        "camera=(self), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), interest-cohort=()",
    },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "X-DNS-Prefetch-Control", value: "off" },
  ];
}
