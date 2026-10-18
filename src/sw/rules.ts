/**
 * Pure routing rules of the service worker (kept free of worker globals so they are unit-tested).
 *
 * NUD-080 contract: the worker caches ONLY the precached app shell (hashed build assets, icons and
 * the generic offline page). Documents, RSC payloads and API responses are never stored, because
 * they can contain personal data of the logged-in user.
 *
 * NUD-081 adds exactly two things, neither of which stores a response in the worker:
 * - the precached, public, personal-data-free offline shell page (`/<locale>/driver/offline-shell`)
 *   answers failed loads of `/<locale>/driver` and `/<locale>/driver/stops/<id>`; the page itself
 *   reads the tour from IndexedDB;
 * - requests for `/api/driver/photo-cache/<photoId>` are answered from the Cache Storage bucket
 *   that the PAGE filled with the photos of the cached tour (the worker only reads it).
 */
import { OFFLINE_SHELL_SEGMENT, PHOTO_CACHE_PATH } from "../lib/offline/constants";

/** Driver pages, with the locale prefix: /de/driver, /zh-Hans/driver/stops/42, ... */
// The locale list is duplicated on purpose (the worker bundle must stay tiny); rules.test.ts checks
// that it matches `LOCALES`.
export const SW_LOCALES = ["de", "zh-Hans", "zh-Hant-HK", "zh-Hant-TW"] as const;
const DRIVER_PATH = new RegExp(`^/(${SW_LOCALES.join("|")})/driver(/|$)`);

export function isDriverPath(pathname: string): boolean {
  return DRIVER_PATH.test(pathname);
}

/**
 * The locale-neutral start URL of the installed app (`/driver?source=pwa`, NUD-106). The server
 * redirects it to `/<locale>/driver`; offline the generic offline page forwards to the locale kept in
 * the `NEXT_LOCALE` cookie.
 */
export function isDriverLaunchPath(pathname: string): boolean {
  return pathname === "/driver" || pathname === "/driver/";
}

/** A top-level page load of the driver area: network only; offline page when the network fails. */
export function isDriverNavigation(request: { mode: string }, url: URL): boolean {
  return (
    request.mode === "navigate" && (isDriverPath(url.pathname) || isDriverLaunchPath(url.pathname))
  );
}

/** Build assets with a content hash in the file name: safe to keep under the same URL forever. */
export function isPrecachedStaticPath(pathname: string): boolean {
  return pathname.startsWith("/_next/static/");
}

const SHELL_ROUTE = new RegExp(`^/(${SW_LOCALES.join("|")})/driver(/stops/[^/]+)?/?$`);

/** Driver screens that can be shown from the offline copy: the tour list and a stop detail. */
export function isOfflineShellRoute(pathname: string): boolean {
  return SHELL_ROUTE.test(pathname);
}

/** The precached shell page for the locale of `pathname`, or `null` for any other path. */
export function offlineShellUrl(pathname: string): string | null {
  const match = SHELL_ROUTE.exec(pathname);
  return match ? `/${match[1]}/${OFFLINE_SHELL_SEGMENT}` : null;
}

/** The precache entries (one shell per locale). */
export function offlineShellUrls(): string[] {
  return SW_LOCALES.map((locale) => `/${locale}/${OFFLINE_SHELL_SEGMENT}`);
}

/** Photos of the cached tour, served from Cache Storage only (never from the network). */
export function isPhotoCachePath(pathname: string): boolean {
  return pathname.startsWith(PHOTO_CACHE_PATH) && pathname.length > PHOTO_CACHE_PATH.length;
}

/**
 * NUD-108 (opt-in `MAP_TILE_CACHE=1`): the pattern of the configured tile URL template
 * (`https://{s}.tile.example/{z}/{x}/{y}{r}.png?key=K`), or `null` when it is not a usable http(s)
 * URL. Placeholders match one path segment / host label, the rest is literal, the query string
 * must be identical.
 */
export function tileUrlPattern(template: string): RegExp | null {
  if (!/^https?:\/\//i.test(template)) return null;
  const source = template
    .split(/(\{[a-z]+\})/i)
    .map((part) => {
      if (/^\{[a-z]+\}$/i.test(part)) {
        const name = part.toLowerCase();
        return name === "{s}" ? "[^/.?#]+" : name === "{r}" ? "[^/?#]*" : "[^/?#]+";
      }
      return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("");
  try {
    return new RegExp(`^${source}$`, "i");
  } catch {
    return null;
  }
}

/** True for a request to a tile of the configured provider (see `tileUrlPattern`). */
export function isTileRequest(url: string, pattern: RegExp | null): boolean {
  return pattern !== null && pattern.test(url);
}
