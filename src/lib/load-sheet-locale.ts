/**
 * Printout languages of the load sheet (NUD-134). Client-safe: no server-only imports, so both the
 * print page and its screen toolbar can use it.
 *
 * The owner wants exactly two choices: German and ONE Chinese option, so the three regional Chinese
 * UI locales (`zh-Hans`, `zh-Hant-HK`, `zh-Hant-TW`) disappear from the picker. The single 中文 link
 * prints the simplified (`zh-Hans`) sheet; that sheet already renders the German product name in
 * small type (`productLabel`), which is what the office asked for.
 */

/** One link per printout language. The labels name the language in its own script and are never translated. */
export const SHEET_LOCALE_OPTIONS = [
  { value: "de", label: "Deutsch" },
  { value: "zh-Hans", label: "中文" },
] as const;

/** The printout language of the load sheet: German or simplified Chinese. */
export type SheetLocale = "de" | "zh-Hans";

/**
 * Maps `?locale=` onto the two offered printout languages.
 *
 * - `"de"` -> `de`, any string starting with `zh` -> `zh-Hans`, everything else -> `de`.
 * - Matching is case-sensitive and literal, exactly like the URL segments; a repeated value arrives
 *   as an array and falls back like any other junk.
 *
 * Every Hant variant folds into `zh-Hans` on purpose: the Hant message files are generated from the
 * simplified ones, the owner explicitly does not want three Chinese options, and this keeps an old
 * or shared `?locale=zh-Hant-TW` URL printing Chinese instead of silently printing German.
 */
export function parseSheetLocale(raw: unknown): SheetLocale {
  if (typeof raw !== "string") return "de";
  if (raw === "de") return "de";
  if (raw.startsWith("zh")) return "zh-Hans";
  return "de";
}
