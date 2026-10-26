import { z } from "zod";

import type { AppLocale } from "@/lib/localized-text";

import { isTrivial } from "./base";
import { type Translator, TranslatorError } from "./types";

export const DEEPL_FREE_URL = "https://api-free.deepl.com";
export const DEEPL_PRO_URL = "https://api.deepl.com";

export type DeepLPlan = "free" | "pro";

const responseSchema = z.object({
  translations: z.array(z.object({ text: z.string() }).loose()).min(1),
});

/** Maps a DeepL `/v2/translate` response body to the translated text. */
export function mapDeepLResponse(body: unknown): string {
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) {
    throw new TranslatorError("Unexpected response from the translation service", "BAD_RESPONSE");
  }
  return parsed.data.translations[0]!.text;
}

/**
 * `DEEPL_API_PLAN=free|pro` wins; without it DeepL's own convention applies: free keys end in
 * `:fx`. Anything else is a pro key.
 */
export function resolvePlan(apiKey: string, plan: string | undefined): DeepLPlan {
  const explicit = plan?.trim().toLowerCase();
  if (explicit === "free" || explicit === "pro") return explicit;
  return apiKey.trim().endsWith(":fx") ? "free" : "pro";
}

export type DeepLTranslatorOptions = {
  apiKey: string;
  plan?: DeepLPlan;
  /** Overrides the endpoint derived from `plan` (tests, proxies). */
  baseUrl?: string;
  timeoutMs?: number;
  /** Extra attempts after a timeout, network error, 5xx or 429. Default 1. */
  retries?: number;
  fetch?: typeof fetch;
};

/** DeepL language codes of the locales it handles. Serbian is not routed here (see `RoutedTranslator`). */
const DEEPL_SOURCE: Partial<Record<AppLocale, string>> = {
  de: "DE",
  en: "EN",
  cs: "CS",
  "zh-Hans": "ZH",
};
const DEEPL_TARGET: Partial<Record<AppLocale, string>> = {
  de: "DE",
  en: "EN-GB",
  cs: "CS",
  "zh-Hans": "ZH-HANS",
};

/**
 * DeepL REST API v2 for German, English, Czech and Simplified Chinese (source `ZH`, target
 * `ZH-HANS`). The key travels in the `Authorization` header only.
 */
export class DeepLTranslator implements Translator {
  readonly kind = "deepl" as const;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: DeepLTranslatorOptions) {
    const plan = options.plan ?? resolvePlan(options.apiKey, undefined);
    this.baseUrl = (options.baseUrl ?? (plan === "free" ? DEEPL_FREE_URL : DEEPL_PRO_URL)).replace(
      /\/+$/,
      "",
    );
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.retries = options.retries ?? 1;
    this.fetchFn = options.fetch ?? fetch;
  }

  async translate(text: string, from: AppLocale, to: AppLocale): Promise<string> {
    if (isTrivial(text, from, to)) return text;
    const sourceLang = DEEPL_SOURCE[from];
    const targetLang = DEEPL_TARGET[to];
    if (!sourceLang || !targetLang) {
      throw new TranslatorError(`DeepL does not translate ${from} -> ${to}`, "UNSUPPORTED");
    }
    const body = JSON.stringify({ text: [text], source_lang: sourceLang, target_lang: targetLang });
    return mapDeepLResponse(await this.post("/v2/translate", body));
  }

  private async post(path: string, body: string): Promise<unknown> {
    let lastError: TranslatorError | undefined;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      let response: Response;
      try {
        response = await this.fetchFn(`${this.baseUrl}${path}`, {
          method: "POST",
          headers: {
            Authorization: `DeepL-Auth-Key ${this.options.apiKey}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error) {
        const timedOut =
          error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        lastError = timedOut
          ? new TranslatorError("Translation service timed out", "TIMEOUT")
          : new TranslatorError("Translation service is unreachable", "NETWORK");
        continue;
      }
      if (response.ok) {
        try {
          return await response.json();
        } catch {
          throw new TranslatorError("Response was not JSON", "BAD_RESPONSE");
        }
      }
      // 456 = character quota exhausted (resets monthly), 429 = too many requests, 5xx incl. 529.
      lastError = new TranslatorError(
        `Translation service answered HTTP ${response.status}`,
        response.status === 456 ? "QUOTA" : "HTTP",
        response.status,
      );
      if (response.status < 500 && response.status !== 429) throw lastError;
    }
    throw lastError ?? new TranslatorError("Translation failed", "NETWORK");
  }
}
