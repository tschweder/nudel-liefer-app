import {
  buildExtractionPrompt,
  type ExtractionAnswer,
  extractionAnswerSchema,
} from "@/domain/order-extraction";

import { type ChatMessage, type OpenRouterClient, OpenRouterError } from "../openrouter";
import {
  type OrderExtractionContext,
  type OrderExtractionInput,
  type OrderExtractionResult,
  type OrderExtractor,
  OrderExtractorError,
} from "./types";

/**
 * The real order extractor (NUD-150, D26): one OpenRouter chat completion with the catalog and the
 * exact JSON contract in the system prompt, plus the customer message as text and/or the screenshot
 * as an image part. The answer is validated with the same schema the contract describes - a model
 * that rambles is a `BAD_RESPONSE`, never a half-filled order.
 */
export class OpenRouterOrderExtractor implements OrderExtractor {
  readonly kind = "openrouter" as const;

  constructor(private readonly client: OpenRouterClient) {}

  async extract(
    input: OrderExtractionInput,
    context: OrderExtractionContext,
  ): Promise<OrderExtractionResult> {
    const text = (input.text ?? "").trim();
    if (text === "" && !input.image) {
      throw new OrderExtractorError("Nothing to read", "EMPTY_INPUT");
    }
    const message: ChatMessage = {
      role: "user",
      content:
        input.image && text === ""
          ? [
              { type: "image_url", image_url: { url: toDataUri(input.image) } },
              { type: "text", text: "Read the order from this screenshot." },
            ]
          : input.image
            ? [
                { type: "text", text: `Customer message:\n${text}` },
                { type: "image_url", image_url: { url: toDataUri(input.image) } },
              ]
            : `Customer message:\n${text}`,
    };
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: buildExtractionPrompt(context.catalog, context.today, context.timezone),
      },
      message,
    ];
    let raw: unknown;
    try {
      raw = await this.client.completeJson(messages, { maxTokens: 1500 });
    } catch (error) {
      throw toExtractorError(error);
    }
    const parsed = extractionAnswerSchema.safeParse(raw);
    if (!parsed.success) {
      throw new OrderExtractorError("The model's answer did not match the contract", "BAD_RESPONSE");
    }
    return { answer: parsed.data as ExtractionAnswer, raw, model: this.client.model };
  }
}

/** Inline image for the vision part; the screenshot is small (<= 15 MB, `MAX_UPLOAD_BYTES`). */
function toDataUri(image: { bytes: Uint8Array; contentType: string }): string {
  const base64 = Buffer.from(image.bytes).toString("base64");
  return `data:${image.contentType};base64,${base64}`;
}

function toExtractorError(error: unknown): OrderExtractorError {
  if (error instanceof OrderExtractorError) return error;
  if (error instanceof OpenRouterError) {
    const code =
      error.code === "TIMEOUT" ||
      error.code === "NETWORK" ||
      error.code === "QUOTA" ||
      error.code === "HTTP" ||
      error.code === "BAD_RESPONSE" ||
      error.code === "NOT_CONFIGURED"
        ? error.code
        : "BAD_RESPONSE";
    return new OrderExtractorError(error.message, code);
  }
  return new OrderExtractorError("The language model is unreachable", "NETWORK");
}
