/**
 * Pure routing rules of the service worker (kept free of worker globals so they are unit-tested).
 *
 * NUD-080 contract: the worker caches ONLY the precached app shell (hashed build assets, icons and
 * the generic offline page). Documents, RSC payloads and API responses are never stored, because
 * they can contain personal data of the logged-in user. Caching tour data is NUD-081.
 */

/** Driver pages, with the locale prefix: /de/driver, /zh-Hans/driver/stops/42, ... */
// The locale list is duplicated on purpose (the worker bundle must stay tiny); rules.test.ts checks
// that it matches `LOCALES`.
export const SW_LOCALES = ["de", "zh-Hans", "zh-Hant-HK", "zh-Hant-TW"] as const;
const DRIVER_PATH = new RegExp(`^/(${SW_LOCALES.join("|")})/driver(/|$)`);

export function isDriverPath(pathname: string): boolean {
  return DRIVER_PATH.test(pathname);
}

/** A top-level page load of the driver area: network only; offline page when the network fails. */
export function isDriverNavigation(request: { mode: string }, url: URL): boolean {
  return request.mode === "navigate" && isDriverPath(url.pathname);
}

/** Build assets with a content hash in the file name: safe to keep under the same URL forever. */
export function isPrecachedStaticPath(pathname: string): boolean {
  return pathname.startsWith("/_next/static/");
}
