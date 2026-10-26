import { z } from "zod";

/**
 * UI/content locales as BCP-47 tags (URL segments, `<html lang>`, LocalizedText keys), D21:
 * German, English, Serbian (Latin script), Czech and Simplified Chinese. Traditional Chinese is gone.
 */
export const LOCALES = ["de", "en", "sr-Latn", "cs", "zh-Hans"] as const;
export type AppLocale = (typeof LOCALES)[number];

/** Languages of the office (admin) screens; the driver screens offer all five. */
export const ADMIN_LOCALES = ["de", "en", "zh-Hans"] as const satisfies readonly AppLocale[];
export const DRIVER_LOCALES = LOCALES;

export const localeSchema = z.enum(LOCALES);

/** Prisma enum member names (`Locale` in schema.prisma) <-> BCP-47 tags. */
const DB_TO_TAG = {
  de: "de",
  en: "en",
  sr_Latn: "sr-Latn",
  cs: "cs",
  zh_Hans: "zh-Hans",
} as const satisfies Record<string, AppLocale>;
export type DbLocale = keyof typeof DB_TO_TAG;

export function dbLocaleToTag(locale: DbLocale): AppLocale {
  return DB_TO_TAG[locale];
}

export function tagToDbLocale(tag: AppLocale): DbLocale {
  return tag.replaceAll("-", "_") as DbLocale;
}

export const localizedTextSchema = z.object({
  de: z.string().optional(),
  en: z.string().optional(),
  "sr-Latn": z.string().optional(),
  cs: z.string().optional(),
  "zh-Hans": z.string().optional(),
  meta: z.object({
    source: localeSchema,
    machine: z.partialRecord(localeSchema, z.boolean()),
    updatedAt: z.string(),
    /**
     * Set by `localize()` (NUD-070) when machine translation failed: only the source is stored and
     * the retry job fills the missing locales later. Absent = nothing pending.
     */
    pendingTranslation: z.boolean().optional(),
    /**
     * Locales whose hand-written text was kept when the source text changed (NUD-071): the office
     * is told to check them against the new source. Absent = nothing to check.
     */
    stale: z.partialRecord(localeSchema, z.boolean()).optional(),
  }),
});
export type LocalizedText = z.infer<typeof localizedTextSchema>;

/** Builds a LocalizedText; `machine` marks locales that were machine-generated. */
export function createLocalizedText(
  values: Partial<Record<AppLocale, string>>,
  source: AppLocale,
  options: {
    machine?: Partial<Record<AppLocale, boolean>>;
    now?: Date;
    pendingTranslation?: boolean;
  } = {},
): LocalizedText {
  const text: LocalizedText = {
    meta: {
      source,
      machine: options.machine ?? {},
      updatedAt: (options.now ?? new Date()).toISOString(),
      ...(options.pendingTranslation ? { pendingTranslation: true } : {}),
    },
  };
  for (const locale of LOCALES) {
    const value = values[locale];
    if (value !== undefined) text[locale] = value;
  }
  return localizedTextSchema.parse(text);
}

/**
 * Read rule (backlog §6, D21): the requested locale; if empty, `de`, then the source locale.
 * Returns "" if nothing is set.
 */
export function pick(text: LocalizedText, locale: AppLocale): string {
  return pickWithSource(text, locale)?.value ?? "";
}

/** Like `pick`, but also says which locale the returned text is written in (`null` if empty). */
export function pickWithSource(
  text: LocalizedText,
  locale: AppLocale,
): { value: string; locale: AppLocale } | null {
  const chain = [locale, "de" as const, text.meta.source];
  for (const candidate of chain) {
    const value = text[candidate];
    if (value && value.trim() !== "") return { value, locale: candidate };
  }
  return null;
}
