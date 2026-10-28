import type { AppLocale } from "@/lib/localized-text";

import { type ChatMessage, type OpenRouterClient, OpenRouterError } from "../openrouter";
import { isTrivial } from "./base";
import { type Translator, TranslatorError } from "./types";

/** Language names for the prompt; the five UI locales (D21). */
const LANGUAGE_NAMES: Record<AppLocale, string> = {
  de: "German",
  en: "English",
  "sr-Latn": "Serbian written in the Latin alphabet",
  cs: "Czech",
  "zh-Hans": "Simplified Chinese",
};

/**
 * Machine translation through OpenRouter (NUD-150, decision log D21/NUD-140). Its job in the app is
 * the Serbian slot of `RoutedTranslator`: DeepL has no Serbian, so `sr-Latn` texts would otherwise
 * stay empty. It can translate any of the five locales, so it also serves as the fallback when no
 * DeepL key is configured.
 */
export class OpenRouterTranslator implements Translator {
  readonly kind = "openrouter" as const;

  constructor(private readonly client: OpenRouterClient) {}

  async translate(text: string, from: AppLocale, to: AppLocale): Promise<string> {
    if (isTrivial(text, from, to)) return text;
    const source = LANGUAGE_NAMES[from];
    const target = LANGUAGE_NAMES[to];
    if (!source || !target) {
      throw new TranslatorError(`Cannot translate ${from} -> ${to}`, "UNSUPPORTED");
    }
    const messages: ChatMessage[] = [
      {
        role: "system",
        content:
          `Translate the user's text from ${source} to ${target}. ` +
          "Keep numbers, product units, names and addresses exactly as they are. " +
          "Answer with the translation only - no quotes, no explanation.",
      },
      { role: "user", content: text },
    ];
    let answer: unknown;
    try {
      answer = await this.client.completeJson(messages, { maxTokens: 1500 });
    } catch (error) {
      throw toTranslatorError(error);
    }
    const translated = extractText(answer);
    if (translated === "") {
      throw new TranslatorError("The translation service returned an empty text", "BAD_RESPONSE");
    }
    return translated;
  }
}

/** The client answers JSON; a bare string or an object with a text field are both accepted. */
function extractText(answer: unknown): string {
  if (typeof answer === "string") return answer.trim();
  if (answer && typeof answer === "object") {
    for (const key of ["translation", "text", "result"]) {
      const value = (answer as Record<string, unknown>)[key];
      if (typeof value === "string" && value.trim() !== "") return value.trim();
    }
  }
  return "";
}

/** Maps the client's error codes onto the translator's (the retry job branches on them). */
function toTranslatorError(error: unknown): TranslatorError {
  if (error instanceof TranslatorError) return error;
  if (error instanceof OpenRouterError) {
    switch (error.code) {
      case "TIMEOUT":
        return new TranslatorError("Translation service timed out", "TIMEOUT", error.status);
      case "QUOTA":
        return new TranslatorError("Translation quota or credits exhausted", "QUOTA", error.status);
      case "HTTP":
        return new TranslatorError(
          `Translation service answered HTTP ${error.status}`,
          "HTTP",
          error.status,
        );
      case "INVALID_INPUT":
        return new TranslatorError("The text cannot be translated", "INVALID_INPUT");
      default:
        return new TranslatorError("Unexpected answer from the translation service", "BAD_RESPONSE");
    }
  }
  return new TranslatorError("Translation service is unreachable", "NETWORK");
}
