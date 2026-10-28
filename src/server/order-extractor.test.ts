import { describe, expect, it, vi } from "vitest";

import { assembleDraft, type CatalogProduct } from "@/domain/order-extraction";
import { createLocalizedText } from "@/lib/localized-text";

import { OpenRouterClient, parseProviders, parseReasoning } from "./openrouter";
import { FakeOrderExtractor } from "./order-extractor";
import { OpenRouterOrderExtractor } from "./order-extractor/openrouter";
import { OpenRouterTranslator } from "./translator/openrouter";

const CATALOG: CatalogProduct[] = [
  {
    id: "pack",
    name: createLocalizedText({ de: "Nudeln", "zh-Hans": "面条" }, "de"),
    unit: "PACK",
  },
  {
    id: "crate",
    name: createLocalizedText({ de: "Nudeln", "zh-Hans": "面条" }, "de"),
    unit: "CRATE",
  },
  {
    id: "wantan",
    name: createLocalizedText({ de: "Wantan-Teig", "zh-Hans": "馄饨皮" }, "de"),
    unit: "PIECE",
  },
];

const CONTEXT = { catalog: CATALOG, today: "2026-10-28", timezone: "Europe/Vienna" };

/** A chat completion answer of OpenRouter with the given JSON content. */
const completion = (content: unknown) =>
  new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );

describe("FakeOrderExtractor (NUD-150 acceptance example)", () => {
  it("reads '2 Karton Nudeln, 5 Beutel, morgen vormittag' into a draft", async () => {
    const extractor = new FakeOrderExtractor();
    const { answer } = await extractor.extract(
      { text: "2 Karton Nudeln, 5 Beutel, morgen vormittag" },
      CONTEXT,
    );
    const draft = assembleDraft(answer, CATALOG);
    expect(draft.lines.map((line) => [line.productId, line.quantity])).toEqual([
      ["crate", "2"],
      ["pack", "5"],
    ]);
    expect(draft.window).toEqual({
      from: "2026-10-29",
      to: "2026-10-29",
      fromTime: "08:00",
      toTime: "12:00",
    });
  });

  it("reads a Chinese message", async () => {
    const extractor = new FakeOrderExtractor();
    const { answer } = await extractor.extract(
      { text: "3 箱 面条，2 袋 面条，明天" },
      CONTEXT,
    );
    const draft = assembleDraft(answer, CATALOG);
    expect(draft.lines.map((line) => [line.productId, line.quantity])).toEqual([
      ["crate", "3"],
      ["pack", "2"],
    ]);
    expect(draft.window?.from).toBe("2026-10-29");
    expect(draft.window?.fromTime).toBe("");
  });

  it("returns no lines for a screenshot-only request (a text stand-in cannot read it)", async () => {
    const extractor = new FakeOrderExtractor();
    const { answer } = await extractor.extract(
      { image: { bytes: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" } },
      CONTEXT,
    );
    expect(answer.lines).toEqual([]);
  });
});

describe("OpenRouterOrderExtractor", () => {
  it("sends the catalog and the message, and validates the answer", async () => {
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      void init;
      return completion({
        lines: [{ label: "Nudeln Kiste", quantity: 4, confidence: 0.9 }],
        confidence: 0.9,
      });
    });
    const extractor = new OpenRouterOrderExtractor(
      new OpenRouterClient({ apiKey: "test-key", model: "test/model", fetch: fetchFn as never }),
    );
    const result = await extractor.extract({ text: "4 Kiste Nudeln" }, CONTEXT);
    expect(result.model).toBe("test/model");
    expect(assembleDraft(result.answer, CATALOG).lines[0]).toMatchObject({
      productId: "crate",
      quantity: "4",
    });
    const init = fetchFn.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("test/model");
    expect(body.messages[0].content).toContain("unit: CRATE");
    expect(body.messages[1].content).toContain("4 Kiste Nudeln");
  });

  it("uses the DeepSeek V4.1 Flash default and switches thinking off", async () => {
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      void init;
      return completion({ lines: [], confidence: 0.5 });
    });
    const extractor = new OpenRouterOrderExtractor(
      new OpenRouterClient({ apiKey: "test-key", fetch: fetchFn as never }),
    );
    await extractor.extract({ text: "2 Kiste Nudeln" }, CONTEXT);
    const body = JSON.parse(String((fetchFn.mock.calls[0]![1] as RequestInit).body));
    expect(body.model).toBe("deepseek/deepseek-v4.1-flash-1017");
    expect(body.reasoning).toEqual({ enabled: false });
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("pins the request to Together and forbids a silent fallback provider", async () => {
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      void init;
      return completion({ lines: [], confidence: 0.5 });
    });
    const extractor = new OpenRouterOrderExtractor(
      new OpenRouterClient({ apiKey: "test-key", fetch: fetchFn as never }),
    );
    await extractor.extract({ text: "2 Kiste Nudeln" }, CONTEXT);
    const body = JSON.parse(String((fetchFn.mock.calls[0]![1] as RequestInit).body));
    expect(body.provider).toEqual({ order: ["together"], allow_fallbacks: false });
  });

  it("sends no provider field when the pinning is switched off", async () => {
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      void init;
      return completion({ lines: [], confidence: 0.5 });
    });
    const extractor = new OpenRouterOrderExtractor(
      new OpenRouterClient({ apiKey: "test-key", providers: [], fetch: fetchFn as never }),
    );
    await extractor.extract({ text: "2 Kiste Nudeln" }, CONTEXT);
    const body = JSON.parse(String((fetchFn.mock.calls[0]![1] as RequestInit).body));
    expect(body.provider).toBeUndefined();
  });

  it("sends the configured thinking budget instead of switching it off", async () => {
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      void init;
      return completion({ lines: [], confidence: 0.5 });
    });
    const extractor = new OpenRouterOrderExtractor(
      new OpenRouterClient({ apiKey: "test-key", reasoning: "high", fetch: fetchFn as never }),
    );
    await extractor.extract({ text: "2 Kiste Nudeln" }, CONTEXT);
    const body = JSON.parse(String((fetchFn.mock.calls[0]![1] as RequestInit).body));
    expect(body.reasoning).toEqual({ effort: "high" });
  });

  it("sends no thinking field at all for the model's own default", async () => {
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      void init;
      return completion({ lines: [], confidence: 0.5 });
    });
    const extractor = new OpenRouterOrderExtractor(
      new OpenRouterClient({ apiKey: "test-key", reasoning: "default", fetch: fetchFn as never }),
    );
    await extractor.extract({ text: "2 Kiste Nudeln" }, CONTEXT);
    const body = JSON.parse(String((fetchFn.mock.calls[0]![1] as RequestInit).body));
    expect(body.reasoning).toBeUndefined();
  });

  it("sends the screenshot as an image part", async () => {
    const fetchFn = vi.fn(async () => completion({ lines: [], confidence: 0.2 }));
    const extractor = new OpenRouterOrderExtractor(
      new OpenRouterClient({ apiKey: "test-key", fetch: fetchFn as never }),
    );
    await extractor.extract(
      { image: { bytes: new Uint8Array([1, 2, 3]), contentType: "image/png" } },
      CONTEXT,
    );
    const init = (fetchFn.mock.calls[0] as unknown[])[1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(JSON.stringify(body.messages[1].content)).toContain("data:image/png;base64,");
  });

  it("refuses an empty request", async () => {
    const extractor = new OpenRouterOrderExtractor(
      new OpenRouterClient({ apiKey: "test-key", fetch: vi.fn() as never }),
    );
    await expect(extractor.extract({}, CONTEXT)).rejects.toMatchObject({ code: "EMPTY_INPUT" });
  });

  it("turns a rambling answer into BAD_RESPONSE instead of a half-filled order", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: "Ich habe es nicht verstanden." } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const extractor = new OpenRouterOrderExtractor(
      new OpenRouterClient({ apiKey: "test-key", fetch: fetchFn as never, retries: 0 }),
    );
    await expect(extractor.extract({ text: "?" }, CONTEXT)).rejects.toMatchObject({
      code: "BAD_RESPONSE",
    });
  });

  it("reports a missing key as NOT_CONFIGURED", async () => {
    const extractor = new OpenRouterOrderExtractor(
      new OpenRouterClient({ apiKey: "  ", fetch: vi.fn() as never }),
    );
    await expect(extractor.extract({ text: "2 Kiste Nudeln" }, CONTEXT)).rejects.toMatchObject({
      code: "NOT_CONFIGURED",
    });
  });

  it("maps an exhausted credit balance to QUOTA", async () => {
    const fetchFn = vi.fn(async () => new Response("no credits", { status: 402 }));
    const extractor = new OpenRouterOrderExtractor(
      new OpenRouterClient({ apiKey: "test-key", fetch: fetchFn as never, retries: 0 }),
    );
    await expect(extractor.extract({ text: "2 Kiste Nudeln" }, CONTEXT)).rejects.toMatchObject({
      code: "QUOTA",
    });
  });
});

describe("parseReasoning (thinking budget of the client)", () => {
  it.each([
    [undefined, "off"],
    ["", "off"],
    ["  OFF ", "off"],
    ["nonsense", "off"],
    ["low", "low"],
    ["Medium", "medium"],
    ["high", "high"],
    ["default", "default"],
  ])("maps %j to %s", (input, expected) => {
    expect(parseReasoning(input)).toBe(expected);
  });
});

describe("parseProviders (routing pin)", () => {
  it.each([
    [undefined, ["together"]],
    ["", ["together"]],
    ["  ", ["together"]],
    ["auto", []],
    ["none", []],
    ["Together", ["together"]],
    [" together , deepseek ", ["together", "deepseek"]],
    ["together,together", ["together"]],
  ])("maps %j to %j", (input, expected) => {
    expect(parseProviders(input)).toEqual(expected);
  });
});

describe("OpenRouterTranslator (Serbian slot, NUD-150)", () => {
  it("translates through the model and trims the answer", async () => {
    const fetchFn = vi.fn(async () => completion({ translation: "Nudle" }));
    const translator = new OpenRouterTranslator(
      new OpenRouterClient({ apiKey: "test-key", fetch: fetchFn as never }),
    );
    expect(await translator.translate("Nudeln", "de", "sr-Latn")).toBe("Nudle");
    expect(translator.kind).toBe("openrouter");
  });

  it("returns the text unchanged for the same locale", async () => {
    const fetchFn = vi.fn();
    const translator = new OpenRouterTranslator(
      new OpenRouterClient({ apiKey: "test-key", fetch: fetchFn as never }),
    );
    expect(await translator.translate("Nudeln", "de", "de")).toBe("Nudeln");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("reports an exhausted quota as a TranslatorError", async () => {
    const fetchFn = vi.fn(async () => new Response("no credits", { status: 402 }));
    const translator = new OpenRouterTranslator(
      new OpenRouterClient({ apiKey: "test-key", fetch: fetchFn as never, retries: 0 }),
    );
    await expect(translator.translate("Nudeln", "de", "sr-Latn")).rejects.toMatchObject({
      name: "TranslatorError",
      code: "QUOTA",
    });
  });
});
