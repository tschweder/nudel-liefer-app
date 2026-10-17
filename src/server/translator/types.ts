import type { AppLocale } from "@/lib/localized-text";

/**
 * Machine translation of user-generated text (D15). Implementations: DeepL (`DeepLTranslator`) and
 * a `FakeTranslator` for tests and for a missing API key. Chinese variants are derived with OpenCC
 * (Hans -> HK / TW); the provider only ever translates between German and Simplified Chinese.
 */
export interface Translator {
  /** `"deepl"` for a real provider, `"fake"` for the stand-in (output is NOT a real translation). */
  readonly kind: "deepl" | "fake";
  /** Translates `text` between two locales. Same locale returns the text unchanged. */
  translate(text: string, from: AppLocale, to: AppLocale): Promise<string>;
}

export type TranslatorErrorCode =
  "TIMEOUT" | "NETWORK" | "HTTP" | "QUOTA" | "BAD_RESPONSE" | "INVALID_INPUT";

export class TranslatorError extends Error {
  constructor(
    message: string,
    readonly code: TranslatorErrorCode,
    readonly status?: number,
  ) {
    super(message);
    this.name = "TranslatorError";
  }
}

/** DeepL accepts up to 128 KiB per request; notes are far shorter (<= 2000 characters). */
export const MAX_TRANSLATION_LENGTH = 5000;
