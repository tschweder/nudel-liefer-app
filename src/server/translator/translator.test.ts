// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { RoutedTranslator } from "./base";
import { DeepLTranslator, mapDeepLResponse, resolvePlan } from "./deepl";
import { FakeTranslator } from "./fake";
import { getTranslator, setTranslatorForTests, TranslatorError } from "./index";

/*
 * The DeepL fixtures are hand-written from the documented v2 API shape (POST /v2/translate ->
 * {"translations":[{"detected_source_language","text"}]}); they were NOT recorded from a live call.
 */
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(__dirname, "fixtures", name), "utf8"));

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const NOTE_DE = "Hintereingang benutzen, nach 10 Uhr klingeln";
const NOTE_HANS = "请使用后门，10点以后按门铃";

afterEach(() => {
  setTranslatorForTests(undefined);
  vi.restoreAllMocks();
});

describe("FakeTranslator", () => {
  const fake = new FakeTranslator();

  it("prefixes the target language", async () => {
    expect(await fake.translate(NOTE_DE, "de", "zh-Hans")).toBe(`[zh-Hans] ${NOTE_DE}`);
    expect(await fake.translate("你好", "zh-Hans", "de")).toBe("[de] 你好");
    expect(await fake.translate("Nudeln", "de", "sr-Latn")).toBe("[sr-Latn] Nudeln");
    expect(await fake.translate("Nudeln", "de", "cs")).toBe("[cs] Nudeln");
    expect(await fake.translate("Nudeln", "de", "en")).toBe("[en] Nudeln");
  });

  it("returns same-locale and blank text unchanged", async () => {
    expect(await fake.translate("abc", "de", "de")).toBe("abc");
    expect(await fake.translate("  ", "de", "zh-Hans")).toBe("  ");
  });

  it("refuses overlong text", async () => {
    await expect(fake.translate("x".repeat(5001), "de", "zh-Hans")).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });
});

describe("DeepL response mapping", () => {
  it("maps the documented shape", () => {
    expect(mapDeepLResponse(fixture("deepl-de-to-zh-hans.json"))).toBe(NOTE_HANS);
  });
  it.each([{}, { translations: [] }, { translations: [{ text: 5 }] }, null, "x"])(
    "rejects %j",
    (body) => {
      expect(() => mapDeepLResponse(body)).toThrow(TranslatorError);
    },
  );
  it("resolves the plan from env, then from the :fx key suffix", () => {
    expect(resolvePlan("abc:fx", undefined)).toBe("free");
    expect(resolvePlan("abc", undefined)).toBe("pro");
    expect(resolvePlan("abc:fx", "pro")).toBe("pro");
    expect(resolvePlan("abc", " FREE ")).toBe("free");
    expect(resolvePlan("abc", "nonsense")).toBe("pro");
  });
});

describe("DeepLTranslator", () => {
  const make = (fetchFn: typeof fetch, extra: Record<string, unknown> = {}) =>
    new DeepLTranslator({ apiKey: "k-123:fx", plan: "free", fetch: fetchFn, ...extra });

  it("sends German -> ZH-HANS to the free endpoint with the key in the header only", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(fixture("deepl-de-to-zh-hans.json")));
    const out = await make(fetchFn as never).translate(NOTE_DE, "de", "zh-Hans");
    expect(out).toBe(NOTE_HANS);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api-free.deepl.com/v2/translate");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("DeepL-Auth-Key k-123:fx");
    expect(url).not.toContain("k-123");
    expect(JSON.parse(init.body as string)).toEqual({
      text: [NOTE_DE],
      source_lang: "DE",
      target_lang: "ZH-HANS",
    });
  });

  it("uses the pro endpoint for the pro plan", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(fixture("deepl-de-to-zh-hans.json")));
    await make(fetchFn as never, { plan: "pro" }).translate(NOTE_DE, "de", "zh-Hans");
    expect((fetchFn.mock.calls[0] as unknown as [string])[0]).toBe(
      "https://api.deepl.com/v2/translate",
    );
  });

  it("sends Chinese -> German with source ZH", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(fixture("deepl-zh-to-de.json")));
    const t = make(fetchFn as never);
    expect(await t.translate("请使用后门", "zh-Hans", "de")).toBe(
      "Bitte den Hintereingang benutzen, nach 10 Uhr klingeln",
    );
    const body = JSON.parse(
      (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    );
    expect(body).toEqual({ text: ["请使用后门"], source_lang: "ZH", target_lang: "DE" });
  });

  it.each([
    ["en", "DE", "EN-GB"],
    ["cs", "DE", "CS"],
  ] as const)("sends German -> %s with the DeepL codes %s -> %s", async (to, source, target) => {
    const fetchFn = vi.fn(async () => jsonResponse(fixture("deepl-pasta.json")));
    await make(fetchFn as never).translate("Nudeln", "de", to);
    const body = JSON.parse(
      (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    );
    expect(body).toMatchObject({ source_lang: source, target_lang: target });
  });

  it("sends Czech and English sources with their own codes", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(fixture("deepl-zh-to-de.json")));
    const t = make(fetchFn as never);
    await t.translate("Zadní vchod", "cs", "de");
    await t.translate("Back door", "en", "zh-Hans");
    const bodies = fetchFn.mock.calls.map((c) =>
      JSON.parse((c as unknown as [string, RequestInit])[1].body as string),
    );
    expect(bodies[0]).toMatchObject({ source_lang: "CS", target_lang: "DE" });
    expect(bodies[1]).toMatchObject({ source_lang: "EN", target_lang: "ZH-HANS" });
  });

  it("does not translate Serbian itself and does not call DeepL for the same locale", async () => {
    const fetchFn = vi.fn();
    const t = make(fetchFn as never);
    await expect(t.translate("Nudeln", "de", "sr-Latn")).rejects.toMatchObject({
      code: "UNSUPPORTED",
    });
    expect(await t.translate("x", "de", "de")).toBe("x");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("retries a 503 once and then succeeds", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: "Service unavailable" }, 503))
      .mockResolvedValueOnce(jsonResponse(fixture("deepl-de-to-zh-hans.json")));
    expect(await make(fetchFn as never).translate(NOTE_DE, "de", "zh-Hans")).toBe(NOTE_HANS);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("retries 429 and network errors, then gives up", async () => {
    const f429 = vi.fn(async () => jsonResponse({}, 429));
    await expect(make(f429 as never).translate("a", "de", "zh-Hans")).rejects.toMatchObject({
      code: "HTTP",
      status: 429,
    });
    expect(f429).toHaveBeenCalledTimes(2);
    const fNet = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(make(fNet as never).translate("a", "de", "zh-Hans")).rejects.toMatchObject({
      code: "NETWORK",
    });
    expect(fNet).toHaveBeenCalledTimes(2);
  });

  it("maps a timeout", async () => {
    const fetchFn = vi.fn(async () => {
      throw new DOMException("timed out", "TimeoutError");
    });
    await expect(
      make(fetchFn as never, { retries: 0 }).translate("a", "de", "zh-Hans"),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("does not retry a refused key (403) and flags the quota error (456)", async () => {
    const f403 = vi.fn(async () => jsonResponse({ message: "Forbidden" }, 403));
    await expect(make(f403 as never).translate("a", "de", "zh-Hans")).rejects.toMatchObject({
      code: "HTTP",
      status: 403,
    });
    expect(f403).toHaveBeenCalledTimes(1);
    const f456 = vi.fn(async () => jsonResponse(fixture("deepl-error-quota.json"), 456));
    await expect(make(f456 as never).translate("a", "de", "zh-Hans")).rejects.toMatchObject({
      code: "QUOTA",
      status: 456,
    });
    expect(f456).toHaveBeenCalledTimes(1);
  });

  it("rejects a malformed answer", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ unexpected: true }));
    await expect(make(fetchFn as never).translate("a", "de", "zh-Hans")).rejects.toMatchObject({
      code: "BAD_RESPONSE",
    });
    const notJson = vi.fn(async () => new Response("<html>", { status: 200 }));
    await expect(make(notJson as never).translate("a", "de", "zh-Hans")).rejects.toMatchObject({
      code: "BAD_RESPONSE",
    });
  });
});

describe("RoutedTranslator (Serbian slot)", () => {
  const primary = {
    kind: "deepl" as const,
    translate: vi.fn(async (t: string, _f: string, to: string) => `P:${to}:${t}`),
  };
  const serbian = {
    kind: "fake" as const,
    translate: vi.fn(async (t: string, _f: string, to: string) => `S:${to}:${t}`),
  };

  it("sends everything without Serbian to the primary provider", async () => {
    const routed = new RoutedTranslator(primary as never, serbian as never);
    expect(await routed.translate("a", "de", "cs")).toBe("P:cs:a");
    expect(serbian.translate).not.toHaveBeenCalled();
  });

  it("sends German <-> Serbian to the Serbian provider and pivots other pairs through German", async () => {
    const routed = new RoutedTranslator(primary as never, serbian as never);
    expect(await routed.translate("a", "de", "sr-Latn")).toBe("S:sr-Latn:a");
    expect(await routed.translate("a", "sr-Latn", "de")).toBe("S:de:a");
    expect(await routed.translate("a", "sr-Latn", "en")).toBe("P:en:S:de:a");
    expect(await routed.translate("a", "zh-Hans", "sr-Latn")).toBe("S:sr-Latn:P:de:a");
  });

  it("throws UNSUPPORTED for Serbian without a Serbian provider and reports the primary kind", async () => {
    const routed = new RoutedTranslator(primary as never, undefined);
    expect(routed.kind).toBe("deepl");
    await expect(routed.translate("a", "de", "sr-Latn")).rejects.toMatchObject({
      code: "UNSUPPORTED",
    });
  });
});

describe("getTranslator", () => {
  it("falls back to the Fake with exactly one warning when the key is missing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getTranslator({}).kind).toBe("fake");
    // The singleton is cached, a second call must not warn again.
    expect(getTranslator({}).kind).toBe("fake");
    expect(getTranslator({ DEEPL_API_KEY: "  " }).kind).toBe("fake");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("DEEPL_API_KEY");
  });

  it("uses DeepL when a key is set (Serbian stays unsupported until its provider exists)", async () => {
    const translator = getTranslator({ DEEPL_API_KEY: "abc:fx" });
    expect(translator.kind).toBe("deepl");
    await expect(translator.translate("Nudeln", "de", "sr-Latn")).rejects.toMatchObject({
      code: "UNSUPPORTED",
    });
  });
});
