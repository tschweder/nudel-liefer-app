/**
 * Sub-path support (self-hosting under `/delivery-app/`).
 *
 * `NEXT_PUBLIC_BASE_PATH` is read at BUILD time: `next.config.ts` passes it to Next's `basePath`,
 * puts the same value into its `env` block (so server and client code see one value) and
 * `scripts/build-pwa.ts` inlines it into the service worker. Next inlines the value into the client
 * bundles, so the value used for `pnpm build` must equal the value used by `pnpm start`; changing it
 * requires a rebuild. Empty by default (development, Vercel and any root deployment).
 *
 * This module is deliberately free of imports: the service worker bundles it (esbuild) and it must
 * stay tree-shakeable for the driver bundle.
 */

/** Normalised base path: `""` (origin root) or `"/delivery-app"`; never a trailing slash. */
export const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").trim().replace(/\/+$/, "");

/** Schemes (`https:`, `data:`, `blob:`, ...): a URL with a scheme is never an app path. */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * `process` is not part of the `webworker` lib of the service-worker TypeScript project
 * (`src/sw/tsconfig.json` sets `types: []`), and this module is compiled into the worker as well.
 * The declaration is local to this module and only exists for the type check: both Next
 * (`next.config.ts` `env`) and esbuild (`scripts/build-pwa.ts` `define`) replace the reference below
 * with the literal build-time value, so no `process` lookup ever reaches a bundle.
 */
declare const process: { env: Record<string, string | undefined> };

/**
 * Prefixes an app-absolute path with the base path (`/offline.html` -> `/delivery-app/offline.html`).
 *
 * - Absolute URLs (`https://...`, `data:`, `blob:`), protocol-relative URLs (`//host/...`) and
 *   relative paths are returned unchanged: they are not served by this app.
 * - Idempotent: a path that already carries the prefix is returned unchanged.
 * - The root stays a directory: `withBasePath("/")` is `"/"` without a base path and
 *   `"/delivery-app/"` with one (a service worker scope must keep its trailing slash).
 *
 * Use it for every URL handed to the browser or the worker. `next/link`, `next/router` and
 * `redirect()` already add the prefix themselves, so their hrefs must stay unprefixed.
 */
export function withBasePath(path: string): string {
  if (!BASE_PATH) return path;
  if (!path.startsWith("/") || path.startsWith("//")) return path;
  if (HAS_SCHEME.test(path)) return path;
  if (path === BASE_PATH || path.startsWith(`${BASE_PATH}/`)) return path;
  return `${BASE_PATH}${path}`;
}

/**
 * Removes the base path from a pathname (`/delivery-app/de/admin` -> `/de/admin`). The inverse of
 * `withBasePath` and safe (a no-op) when the base path is empty or was already removed. Treats
 * `/delivery-app` itself as the root `/`.
 */
export function stripBasePath(pathname: string): string {
  if (!BASE_PATH) return pathname;
  if (pathname === BASE_PATH) return "/";
  if (pathname.startsWith(`${BASE_PATH}/`)) return pathname.slice(BASE_PATH.length);
  return pathname;
}
