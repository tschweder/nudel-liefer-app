import { RoutedTranslator } from "./base";
import { DeepLTranslator, resolvePlan } from "./deepl";
import { FakeTranslator } from "./fake";
import type { Translator } from "./types";

export { RoutedTranslator } from "./base";
export { DeepLTranslator, mapDeepLResponse, resolvePlan } from "./deepl";
export { FakeTranslator } from "./fake";
export * from "./types";

let instance: Translator | undefined;
let warned = false;

/**
 * Translator selected from the environment: DeepL when `DEEPL_API_KEY` is set, otherwise the
 * `FakeTranslator` and a single warning (its output carries a visible `[zh-Hans]` prefix). Serbian (Latin) is routed to its own slot..
 */
export function getTranslator(env: Record<string, string | undefined> = process.env): Translator {
  if (instance) return instance;
  const apiKey = env.DEEPL_API_KEY?.trim();
  if (apiKey) {
    // Serbian (Latin) has no provider yet: NUD-150 plugs the OpenRouter translator in here.
    instance = new RoutedTranslator(
      new DeepLTranslator({ apiKey, plan: resolvePlan(apiKey, env.DEEPL_API_PLAN) }),
      undefined,
    );
  } else {
    if (!warned) {
      warned = true;
      console.warn(
        "[translator] DEEPL_API_KEY not set - using the FakeTranslator (texts get a visible [en] / [zh-Hans] ... prefix, they are NOT translated)",
      );
    }
    instance = new FakeTranslator();
  }
  return instance;
}

/** Test helper. */
export function setTranslatorForTests(translator: Translator | undefined) {
  instance = translator;
  if (!translator) warned = false;
}
