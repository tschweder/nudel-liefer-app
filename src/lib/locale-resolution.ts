import { ADMIN_LOCALES, type AppLocale, DRIVER_LOCALES, LOCALES } from "./localized-text";

export const DEFAULT_LOCALE: AppLocale = "de";
export const LOCALE_COOKIE = "NEXT_LOCALE";

/** Each language in its own script, for the language switcher. */
export const LOCALE_LABELS: Record<AppLocale, string> = {
  de: "Deutsch",
  en: "English",
  "sr-Latn": "Srpski",
  cs: "Čeština",
  "zh-Hans": "中文",
};

/** Short codes for the compact driver switcher (login segmented control). */
export const LOCALE_SHORT_LABELS: Record<AppLocale, string> = {
  de: "DE",
  en: "EN",
  "sr-Latn": "SR",
  cs: "CS",
  "zh-Hans": "中文",
};

export type LocaleArea = "admin" | "driver";

/** Languages offered in an area: office Deutsch · English · 中文, driver all five (D21). */
export function localesFor(area: LocaleArea): readonly AppLocale[] {
  return area === "admin" ? ADMIN_LOCALES : DRIVER_LOCALES;
}

/** Whether `locale` may be used on the office screens. A driver-only locale falls back to `de` there. */
export function isAdminLocale(locale: string): boolean {
  return (ADMIN_LOCALES as readonly string[]).includes(locale);
}

/** The locale an admin page is shown in when the requested one is driver-only. */
export function adminLocaleFor(locale: AppLocale): AppLocale {
  return isAdminLocale(locale) ? locale : DEFAULT_LOCALE;
}

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * Maps one Accept-Language / BCP-47 tag to an app locale, or null if unsupported:
 * `zh-*` -> `zh-Hans`, `sr` / `sr-Latn` / `sr-Cyrl` -> `sr-Latn`, `cs` -> `cs`, `en-*` -> `en`.
 */
export function matchLanguageTag(tag: string): AppLocale | null {
  const t = tag.trim().toLowerCase();
  const language = t.split("-")[0];
  if (language === "de") return "de";
  if (language === "en") return "en";
  if (language === "cs") return "cs";
  if (language === "sr") return "sr-Latn";
  if (language === "zh") return "zh-Hans";
  return null;
}

/** Best match from an Accept-Language header (q-values respected), or null. */
export function matchAcceptLanguage(header: string | null | undefined): AppLocale | null {
  if (!header) return null;
  const entries = header
    .split(",")
    .map((part, index) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const quality = q ? Number.parseFloat(q.slice(2)) : 1;
      return { tag, quality: Number.isNaN(quality) ? 0 : quality, index };
    })
    .filter((e) => e.tag !== "" && e.tag !== "*" && e.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index);
  for (const { tag } of entries) {
    const match = matchLanguageTag(tag);
    if (match) return match;
  }
  return null;
}

/** Resolution order: user's saved locale -> NEXT_LOCALE cookie -> Accept-Language -> `de`. */
export function resolveLocale(input: {
  userLocale?: string | null;
  cookie?: string | null;
  acceptLanguage?: string | null;
}): AppLocale {
  if (isAppLocale(input.userLocale)) return input.userLocale;
  if (isAppLocale(input.cookie)) return input.cookie;
  return matchAcceptLanguage(input.acceptLanguage) ?? DEFAULT_LOCALE;
}
