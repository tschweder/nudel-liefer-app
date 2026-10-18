import { resolveLocale } from "./locale-resolution";

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
  const locale = resolveLocale(input);
  return `/${locale}${input.pathname === "/" ? "" : input.pathname}${input.search}`;
}
