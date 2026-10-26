import {
  type AppLocale,
  createLocalizedText,
  LOCALES,
  type LocalizedText,
} from "@/lib/localized-text";

import { getTranslator } from "./index";
import { type Translator, TranslatorError } from "./types";

const isEmpty = (value: string | undefined): boolean => value === undefined || value.trim() === "";

/**
 * Fills every missing locale of `text` from its source locale and updates `meta.pendingTranslation`.
 * Existing values (hand-written or edited) are never overwritten; filled locales are flagged in
 * `meta.machine`. One provider call per missing locale, run in parallel.
 *
 * - A locale the provider cannot do (`UNSUPPORTED`, e.g. Serbian before NUD-150) stays empty and does
 *   NOT keep the text pending (it would never complete and would clog the retry job); readers fall
 *   back to German.
 * - `targets` limits the work to some locales (a driver's problem note only needs German for the office).
 * - Any other failure leaves that locale empty and the text pending; the retry job tries again. When
 *   nothing could be filled at all, the first such error is thrown so the caller can tell an outage
 *   from a partial success (`localize` keeps the source and marks the text pending).
 */
export async function completeTranslation(
  text: LocalizedText,
  translator: Translator,
  now: Date = new Date(),
  targetLocales: readonly AppLocale[] = LOCALES,
): Promise<LocalizedText> {
  const source = text.meta.source;
  const sourceText = text[source];
  const next: LocalizedText = {
    ...text,
    meta: { ...text.meta, machine: { ...text.meta.machine } },
  };
  delete next.meta.pendingTranslation;

  if (!isEmpty(sourceText)) {
    const targets = targetLocales.filter((l) => l !== source && isEmpty(next[l]));
    const results = await Promise.allSettled(
      targets.map((to) => translateChecked(translator, sourceText!, source, to)),
    );
    let filled = 0;
    let firstError: unknown;
    let retryable = false;
    results.forEach((result, index) => {
      const locale = targets[index]!;
      if (result.status === "fulfilled") {
        next[locale] = result.value;
        next.meta.machine[locale] = true;
        filled++;
        return;
      }
      firstError ??= result.reason;
      const unsupported =
        result.reason instanceof TranslatorError && result.reason.code === "UNSUPPORTED";
      if (!unsupported) retryable = true;
    });
    if (retryable) {
      if (filled === 0) throw firstError;
      next.meta.pendingTranslation = true;
    }
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
 * Produces a `LocalizedText` with all five locales from one source text (D15, D21). Never throws and
 * never blocks saving: when the provider fails the result holds the source only and
 * `meta.pendingTranslation = true`; the retry job (`retryPendingTranslations`) fills the rest
 * later. Translated locales get `meta.machine = true`.
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
    return { ...base, meta: { ...base.meta, pendingTranslation: true } };
  }
}
