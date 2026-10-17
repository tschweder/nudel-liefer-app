import { defineRouting } from "next-intl/routing";

import { DEFAULT_LOCALE, LOCALE_COOKIE } from "@/lib/locale-resolution";
import { LOCALES } from "@/lib/localized-text";

export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: "always",
  // Detection is done by src/proxy.ts (user -> cookie -> Accept-Language -> de).
  localeDetection: false,
  localeCookie: { name: LOCALE_COOKIE, maxAge: 60 * 60 * 24 * 365 },
});
