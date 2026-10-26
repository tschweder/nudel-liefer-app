import type { AppLocale } from "@/lib/localized-text";

import { MAX_TRANSLATION_LENGTH, type Translator, TranslatorError } from "./types";

/** Shared input checks of all providers; returns true when the text can be returned unchanged. */
export function isTrivial(text: string, from: AppLocale, to: AppLocale): boolean {
  if (from === to || text.trim() === "") return true;
  if (text.length > MAX_TRANSLATION_LENGTH) {
    throw new TranslatorError(
      `Text is longer than ${MAX_TRANSLATION_LENGTH} characters`,
      "INVALID_INPUT",
    );
  }
  return false;
}

/**
 * Sends everything that involves Serbian (Latin) to its own provider and the rest to the primary one.
 * Serbian <-> another non-German language pivots through German. Without a Serbian provider the
 * call throws `UNSUPPORTED`; `completeTranslation` then leaves the Serbian text empty and the
 * readers fall back to German.
 */
export class RoutedTranslator implements Translator {
  constructor(
    private readonly primary: Translator,
    private readonly serbian: Translator | undefined,
  ) {}

  get kind(): Translator["kind"] {
    return this.primary.kind;
  }

  async translate(text: string, from: AppLocale, to: AppLocale): Promise<string> {
    if (isTrivial(text, from, to)) return text;
    if (from !== "sr-Latn" && to !== "sr-Latn") return this.primary.translate(text, from, to);
    if (!this.serbian) {
      throw new TranslatorError("No Serbian translation provider is configured", "UNSUPPORTED");
    }
    if (from === "de" || to === "de") return this.serbian.translate(text, from, to);
    const viaGerman = await (from === "sr-Latn" ? this.serbian : this.primary).translate(
      text,
      from,
      "de",
    );
    return (to === "sr-Latn" ? this.serbian : this.primary).translate(viaGerman, "de", to);
  }
}
