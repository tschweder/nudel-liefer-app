import type { AppLocale } from "@/lib/localized-text";
import { hansToHk, hansToTw, hantToHans } from "@/lib/opencc";

import { MAX_TRANSLATION_LENGTH, TranslatorError } from "./types";

/** Languages a provider has to handle itself: everything else is OpenCC. */
export type CoreSource = "de" | "zh";
export type CoreTarget = "de" | "zh-Hans";

export const isChinese = (locale: AppLocale): boolean => locale !== "de";

/** Converts between Chinese variants without any provider call. */
export function convertChinese(text: string, from: AppLocale, to: AppLocale): string {
  if (from === to) return text;
  // Anything -> Simplified first (Hans stays Hans), then Simplified -> the requested variant.
  const hans = from === "zh-Hans" ? text : hantToHans(text);
  if (to === "zh-Hans") return hans;
  return to === "zh-Hant-HK" ? hansToHk(hans) : hansToTw(hans);
}

/**
 * Shared routing for providers: German <-> Chinese goes through `call` once (German <-> Simplified),
 * Hant targets are produced from the Simplified result with OpenCC (`cn->hk`, `cn->twp`), and
 * Chinese -> Chinese never leaves the process.
 */
export abstract class ChineseAwareTranslator {
  protected abstract call(text: string, from: CoreSource, to: CoreTarget): Promise<string>;

  async translate(text: string, from: AppLocale, to: AppLocale): Promise<string> {
    if (from === to || text.trim() === "") return text;
    if (text.length > MAX_TRANSLATION_LENGTH) {
      throw new TranslatorError(
        `Text is longer than ${MAX_TRANSLATION_LENGTH} characters`,
        "INVALID_INPUT",
      );
    }
    if (isChinese(from) && isChinese(to)) return convertChinese(text, from, to);
    if (to === "de") return this.call(text, "zh", "de");
    const hans = await this.call(text, "de", "zh-Hans");
    return convertChinese(hans, "zh-Hans", to);
  }
}
