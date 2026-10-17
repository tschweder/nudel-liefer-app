import { type AppLocale, LOCALES } from "./localized-text";

export const DEFAULT_LOCALE: AppLocale = "de";
export const LOCALE_COOKIE = "NEXT_LOCALE";

/** Each language in its own script, for the language switcher. */
export const LOCALE_LABELS: Record<AppLocale, string> = {
  de: "Deutsch",
  "zh-Hans": "简体中文",
  "zh-Hant-HK": "繁體中文（香港）",
  "zh-Hant-TW": "繁體中文（台灣）",
};

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** Maps one Accept-Language / BCP-47 tag to an app locale, or null if unsupported. */
export function matchLanguageTag(tag: string): AppLocale | null {
  const t = tag.trim().toLowerCase();
  if (t === "de" || t.startsWith("de-")) return "de";
  if (t === "zh" || t === "zh-cn" || t === "zh-sg" || t.startsWith("zh-hans")) return "zh-Hans";
  if (t === "zh-hk" || t === "zh-mo" || t.startsWith("zh-hant-hk") || t.startsWith("zh-hant-mo")) {
    return "zh-Hant-HK";
  }
  if (t === "zh-tw" || t.startsWith("zh-hant")) return "zh-Hant-TW";
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
