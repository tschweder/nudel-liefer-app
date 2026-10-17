import { z } from "zod";

/** UI/content locales as BCP-47 tags (URL segments, `<html lang>`, LocalizedText keys). */
export const LOCALES = ["de", "zh-Hans", "zh-Hant-HK", "zh-Hant-TW"] as const;
export type AppLocale = (typeof LOCALES)[number];

export const localeSchema = z.enum(LOCALES);

/** Prisma enum member names (`Locale` in schema.prisma) <-> BCP-47 tags. */
const DB_TO_TAG = {
  de: "de",
  zh_Hans: "zh-Hans",
  zh_Hant_HK: "zh-Hant-HK",
  zh_Hant_TW: "zh-Hant-TW",
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
  "zh-Hans": z.string().optional(),
  "zh-Hant-HK": z.string().optional(),
  "zh-Hant-TW": z.string().optional(),
  meta: z.object({
    source: localeSchema,
    machine: z.partialRecord(localeSchema, z.boolean()),
    updatedAt: z.string(),
  }),
});
export type LocalizedText = z.infer<typeof localizedTextSchema>;

/** Builds a LocalizedText; `machine` marks locales that were machine-generated. */
export function createLocalizedText(
  values: Partial<Record<AppLocale, string>>,
  source: AppLocale,
  options: { machine?: Partial<Record<AppLocale, boolean>>; now?: Date } = {},
): LocalizedText {
  const text: LocalizedText = {
    meta: {
      source,
      machine: options.machine ?? {},
      updatedAt: (options.now ?? new Date()).toISOString(),
    },
  };
  for (const locale of LOCALES) {
    const value = values[locale];
    if (value !== undefined) text[locale] = value;
  }
  return localizedTextSchema.parse(text);
}

const FALLBACK_CHAIN: Record<AppLocale, AppLocale[]> = {
  de: ["de"],
  "zh-Hans": ["zh-Hans", "zh-Hant-HK", "zh-Hant-TW"],
  "zh-Hant-HK": ["zh-Hant-HK", "zh-Hant-TW", "zh-Hans"],
  "zh-Hant-TW": ["zh-Hant-TW", "zh-Hant-HK", "zh-Hans"],
};

/**
 * Read rule (backlog §6): requested locale; if empty, the closest Chinese variant
 * (HK <-> TW, then Hans), then `de`, then the source locale. Returns "" if nothing is set.
 */
export function pick(text: LocalizedText, locale: AppLocale): string {
  const chain = [...FALLBACK_CHAIN[locale], "de" as const, text.meta.source];
  for (const candidate of chain) {
    const value = text[candidate];
    if (value && value.trim() !== "") return value;
  }
  return "";
}
