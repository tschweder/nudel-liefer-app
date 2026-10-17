import { z } from "zod";

import { hansToHk, hansToTw, hantToHans } from "./opencc";

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
  return pickWithSource(text, locale)?.value ?? "";
}

/** Like `pick`, but also says which locale the returned text is written in (`null` if empty). */
export function pickWithSource(
  text: LocalizedText,
  locale: AppLocale,
): { value: string; locale: AppLocale } | null {
  const chain = [...FALLBACK_CHAIN[locale], "de" as const, text.meta.source];
  for (const candidate of chain) {
    const value = text[candidate];
    if (value && value.trim() !== "") return { value, locale: candidate };
  }
  return null;
}

const isEmpty = (value: string | undefined): boolean => value === undefined || value.trim() === "";

/**
 * Fills empty Traditional variants from Simplified via OpenCC (`cn->hk`, `cn->twp`). If
 * Simplified is empty but a Traditional variant exists, Simplified is derived first (`t->cn`).
 * Derived locales are flagged in `meta.machine`; existing values are never overwritten.
 */
export function withDerivedHant(text: LocalizedText, now: Date = new Date()): LocalizedText {
  const next: LocalizedText = {
    ...text,
    meta: { ...text.meta, machine: { ...text.meta.machine } },
  };
  const derived: AppLocale[] = [];

  if (isEmpty(next["zh-Hans"])) {
    const hant = [next["zh-Hant-HK"], next["zh-Hant-TW"]].find((v) => !isEmpty(v));
    if (hant !== undefined) {
      next["zh-Hans"] = hantToHans(hant);
      derived.push("zh-Hans");
    }
  }
  const hans = next["zh-Hans"];
  if (hans !== undefined && !isEmpty(hans)) {
    if (isEmpty(next["zh-Hant-HK"])) {
      next["zh-Hant-HK"] = hansToHk(hans);
      derived.push("zh-Hant-HK");
    }
    if (isEmpty(next["zh-Hant-TW"])) {
      next["zh-Hant-TW"] = hansToTw(hans);
      derived.push("zh-Hant-TW");
    }
  }
  if (derived.length === 0) return text;
  for (const locale of derived) next.meta.machine[locale] = true;
  next.meta.updatedAt = now.toISOString();
  return next;
}
