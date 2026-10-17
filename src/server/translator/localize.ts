import {
  type AppLocale,
  createLocalizedText,
  type LocalizedText,
  withDerivedHant,
} from "@/lib/localized-text";

import { getTranslator } from "./index";
import { type Translator, TranslatorError } from "./types";

const isEmpty = (value: string | undefined): boolean => value === undefined || value.trim() === "";
const CHINESE: AppLocale[] = ["zh-Hans", "zh-Hant-HK", "zh-Hant-TW"];

/**
 * Fills every missing locale of `text` and clears `meta.pendingTranslation`. Existing values
 * (hand-written or edited) are never overwritten; filled locales are flagged in `meta.machine`.
 * One provider call at most: German source -> Simplified (Hant via OpenCC), Chinese source -> German
 * (the other Chinese variants via OpenCC). Throws `TranslatorError` when the provider fails; the
 * caller decides what that means (`localize` keeps the source and marks the text pending).
 */
export async function completeTranslation(
  text: LocalizedText,
  translator: Translator,
  now: Date = new Date(),
): Promise<LocalizedText> {
  const source = text.meta.source;
  const sourceText = text[source];
  let next: LocalizedText = { ...text, meta: { ...text.meta, machine: { ...text.meta.machine } } };
  delete next.meta.pendingTranslation;

  if (!isEmpty(sourceText)) {
    if (source === "de") {
      if (CHINESE.every((l) => isEmpty(next[l]))) {
        next["zh-Hans"] = await translateChecked(translator, sourceText!, source, "zh-Hans");
        next.meta.machine["zh-Hans"] = true;
      }
    } else if (isEmpty(next.de)) {
      next.de = await translateChecked(translator, sourceText!, source, "de");
      next.meta.machine.de = true;
    }
    next = withDerivedHant(next, now);
  }
  next.meta.updatedAt = now.toISOString();
  return next;
}

async function translateChecked(
  translator: Translator,
  text: string,
  from: AppLocale,
  to: AppLocale,
): Promise<string> {
  const result = await translator.translate(text, from, to);
  if (isEmpty(result)) {
    throw new TranslatorError("Translation service returned an empty text", "BAD_RESPONSE");
  }
  return result;
}

/**
 * Produces a `LocalizedText` with all four locales from one source text (D15). Never throws and
 * never blocks saving: when the provider fails the result holds the source (plus the Chinese
 * variants OpenCC can derive offline) and `meta.pendingTranslation = true`; the retry job
 * (`retryPendingTranslations`) fills the rest later. Translated locales get `meta.machine = true`.
 */
export async function localize(
  text: string,
  sourceLocale: AppLocale,
  options: { translator?: Translator; now?: Date } = {},
): Promise<LocalizedText> {
  const now = options.now ?? new Date();
  const trimmed = text.trim();
  const base = createLocalizedText({ [sourceLocale]: trimmed }, sourceLocale, { now });
  if (trimmed === "") return base;
  try {
    return await completeTranslation(base, options.translator ?? getTranslator(), now);
  } catch (error) {
    const code = error instanceof TranslatorError ? error.code : "UNKNOWN";
    // Never log the text itself (customer notes, driver messages).
    console.warn(
      `[translator] translation failed (${code}); stored the source only, retry pending`,
    );
    const offline = sourceLocale === "de" ? base : withDerivedHant(base, now);
    return { ...offline, meta: { ...offline.meta, pendingTranslation: true } };
  }
}
