import type { AppLocale } from "@/lib/localized-text";

/**
 * Machine translation of user-generated text (D15, D21). Implementations: DeepL (`DeepLTranslator`,
 * German, English, Czech, Simplified Chinese) and a `FakeTranslator` for tests and for a missing API
 * key. Serbian (Latin) sits behind a separate provider slot (`RoutedTranslator`): the real
 * connection (OpenRouter) comes with NUD-150, until then `translate` throws `UNSUPPORTED` for it.
 */
export interface Translator {
  /** `"deepl"` for a real provider, `"fake"` for the stand-in (output is NOT a real translation). */
  readonly kind: "deepl" | "fake";
  /** Translates `text` between two locales. Same locale returns the text unchanged. */
  translate(text: string, from: AppLocale, to: AppLocale): Promise<string>;
}

export type TranslatorErrorCode =
  "TIMEOUT" | "NETWORK" | "HTTP" | "QUOTA" | "BAD_RESPONSE" | "INVALID_INPUT" | "UNSUPPORTED";

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
