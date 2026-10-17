import { ChineseAwareTranslator, type CoreSource, type CoreTarget } from "./base";
import type { Translator } from "./types";

/**
 * Stand-in for tests and a missing API key. It does not translate: it prefixes the target
 * language so the result is obviously not a real translation (`[zh-Hans] text`, `[de] text`).
 * Traditional targets get the same prefix with OpenCC-converted text.
 */
export class FakeTranslator extends ChineseAwareTranslator implements Translator {
  readonly kind = "fake" as const;

  protected async call(text: string, _from: CoreSource, to: CoreTarget): Promise<string> {
    return `[${to}] ${text}`;
  }
}
