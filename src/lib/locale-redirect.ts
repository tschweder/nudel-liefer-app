import { adminLocaleFor, resolveLocale } from "./locale-resolution";

/**
 * Target of the redirect for a path without a locale prefix (`/driver?source=pwa` ->
 * `/zh-Hans/driver?source=pwa`). The locale is the user's CURRENT one: session locale (kept in sync
 * by the language switcher) -> `NEXT_LOCALE` cookie -> Accept-Language -> `de`. Path and query are
 * kept. Used by `proxy.ts`; pure so the rules are unit-tested (NUD-003, NUD-106).
 */
export function localeRedirectPath(input: {
  pathname: string;
  search: string;
  userLocale?: string | null;
  cookie?: string | null;
  acceptLanguage?: string | null;
}): string {
  const resolved = resolveLocale(input);
  // The office screens exist in de/en/zh-Hans only: a driver-only language falls back to German there.
  const isAdminPath = input.pathname === "/admin" || input.pathname.startsWith("/admin/");
  const locale = isAdminPath ? adminLocaleFor(resolved) : resolved;
  return `/${locale}${input.pathname === "/" ? "" : input.pathname}${input.search}`;
}
