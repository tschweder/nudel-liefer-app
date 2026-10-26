import type { AppLocale } from "@/lib/localized-text";

import { isTrivial } from "./base";
import type { Translator } from "./types";

/**
 * Stand-in for tests and a missing API key. It does not translate: it prefixes the target
 * language so the result is obviously not a real translation (`[zh-Hans] text`, `[sr-Latn] text`).
 */
export class FakeTranslator implements Translator {
  readonly kind = "fake" as const;

  async translate(text: string, from: AppLocale, to: AppLocale): Promise<string> {
    if (isTrivial(text, from, to)) return text;
    return `[${to}] ${text}`;
  }
}
