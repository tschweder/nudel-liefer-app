import { z } from "zod";

/**
 * Minimal OpenRouter client (NUD-150): one chat completion that must answer with JSON. Both the
 * order extraction (text or screenshot) and the Serbian translator sit on it, so the key, the model,
 * the timeout and the error mapping live in exactly one place.
 *
 * The key travels in the `Authorization` header only, never in a URL and never in a log line.
 */

export const OPENROUTER_DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

/**
 * Default model: multimodal (a pasted screenshot is sent as an image part) and strong in German and
 * Chinese. Overridable with `OPENROUTER_MODEL`; a text-only model simply fails on screenshots.
 */
export const OPENROUTER_DEFAULT_MODEL = "google/gemini-2.5-flash";

export type OpenRouterErrorCode =
  "TIMEOUT" | "NETWORK" | "HTTP" | "QUOTA" | "BAD_RESPONSE" | "INVALID_INPUT" | "NOT_CONFIGURED";

export class OpenRouterError extends Error {
  constructor(
    message: string,
    readonly code: OpenRouterErrorCode,
    readonly status?: number,
  ) {
    super(message);
    this.name = "OpenRouterError";
  }
}

export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type ChatMessage = { role: "system" | "user"; content: string | ChatContentPart[] };

const responseSchema = z
  .object({
    choices: z
      .array(z.object({ message: z.object({ content: z.string() }).loose() }).loose())
      .min(1),
  })
  .loose();

/**
 * The model's answer as JSON. Models happily wrap JSON in a ```json fence or add a sentence around
 * it, so the first `{` to the last `}` is taken; anything else is a `BAD_RESPONSE` (never a guess).
 */
export function parseJsonAnswer(content: string): unknown {
  const text = content.trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  const candidate = start >= 0 && end > start ? text.slice(start, end + 1) : "";
  if (candidate === "") {
    throw new OpenRouterError("The model did not answer with JSON", "BAD_RESPONSE");
  }
  try {
    return JSON.parse(candidate);
  } catch {
    throw new OpenRouterError("The model's JSON could not be parsed", "BAD_RESPONSE");
  }
}

export type OpenRouterClientOptions = {
  apiKey: string;
  model?: string;
  /** Overrides the OpenRouter base URL (tests, proxies). */
  baseUrl?: string;
  timeoutMs?: number;
  /** Extra attempts after a timeout, network error, 5xx or 429. Default 1. */
  retries?: number;
  /** `HTTP-Referer` OpenRouter shows in its own dashboard; optional and never a secret. */
  referer?: string;
  fetch?: typeof fetch;
};

export class OpenRouterClient {
  readonly model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: OpenRouterClientOptions) {
    this.model = options.model?.trim() || OPENROUTER_DEFAULT_MODEL;
    this.baseUrl = (options.baseUrl ?? OPENROUTER_DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.retries = options.retries ?? 1;
    this.fetchFn = options.fetch ?? fetch;
  }

  /**
   * One chat completion, parsed as JSON. `maxTokens` stays modest on purpose: every answer here is a
   * short structured object, and a runaway answer costs money.
   */
  async completeJson(
    messages: readonly ChatMessage[],
    options: { maxTokens?: number; temperature?: number } = {},
  ): Promise<unknown> {
    if (this.options.apiKey.trim() === "") {
      throw new OpenRouterError("OPENROUTER_API_KEY is not set", "NOT_CONFIGURED");
    }
    if (messages.length === 0) {
      throw new OpenRouterError("No messages to send", "INVALID_INPUT");
    }
    const body = JSON.stringify({
      model: this.model,
      messages,
      max_tokens: options.maxTokens ?? 1200,
      temperature: options.temperature ?? 0,
      response_format: { type: "json_object" },
    });
    const answer = await this.post(body);
    const parsed = responseSchema.safeParse(answer);
    if (!parsed.success) {
      throw new OpenRouterError("Unexpected answer from the language model", "BAD_RESPONSE");
    }
    return parseJsonAnswer(parsed.data.choices[0]!.message.content);
  }

  private async post(body: string): Promise<unknown> {
    let lastError: OpenRouterError | undefined;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      let response: Response;
      try {
        response = await this.fetchFn(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.options.apiKey}`,
            "Content-Type": "application/json",
            Accept: "application/json",
            "X-Title": "Nudelfabrik Liefermanagement",
            ...(this.options.referer ? { "HTTP-Referer": this.options.referer } : {}),
          },
          body,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error) {
        const timedOut =
          error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        lastError = timedOut
          ? new OpenRouterError("The language model timed out", "TIMEOUT")
          : new OpenRouterError("The language model is unreachable", "NETWORK");
        continue;
      }
      if (response.ok) {
        try {
          return await response.json();
        } catch {
          throw new OpenRouterError("The answer was not JSON", "BAD_RESPONSE");
        }
      }
      lastError = new OpenRouterError(
        `The language model answered HTTP ${response.status}`,
        response.status === 402 || response.status === 429 ? "QUOTA" : "HTTP",
        response.status,
      );
      if (response.status < 500 && response.status !== 429) throw lastError;
    }
    throw lastError ?? new OpenRouterError("The request failed", "NETWORK");
  }
}

/** True when an OpenRouter key is configured; the AI paths stay off without one (D26, NUD-150). */
export function isOpenRouterConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return (env.OPENROUTER_API_KEY?.trim() ?? "") !== "";
}

/** Client from the environment, or `null` when no key is set. */
export function createOpenRouterClient(
  env: Record<string, string | undefined> = process.env,
): OpenRouterClient | null {
  const apiKey = env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) return null;
  return new OpenRouterClient({
    apiKey,
    model: env.OPENROUTER_MODEL,
    baseUrl: env.OPENROUTER_BASE_URL,
    referer: env.OPENROUTER_REFERER,
  });
}
