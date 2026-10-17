// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

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
    expect(await fake.translate("你好", "zh-Hant-HK", "de")).toBe("[de] 你好");
  });

  it("converts Hant targets with OpenCC and keeps the prefix", async () => {
    const hk = await fake.translate("意大利面", "de", "zh-Hant-HK");
    const tw = await fake.translate("意大利面", "de", "zh-Hant-TW");
    expect(hk.startsWith("[zh-Hans] ")).toBe(true);
    expect(hk).toContain("意大利麪");
    expect(tw).toContain("義大利麵");
  });

  it("converts Chinese to Chinese locally and returns same-locale text unchanged", async () => {
    expect(await fake.translate("意大利面", "zh-Hans", "zh-Hant-TW")).toBe("義大利麵");
    expect(await fake.translate("義大利麵", "zh-Hant-TW", "zh-Hans")).toBe("义大利面");
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

  it("sends Chinese -> German with source ZH, whichever script", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(fixture("deepl-zh-to-de.json")));
    const t = make(fetchFn as never);
    expect(await t.translate("請使用後門", "zh-Hant-HK", "de")).toBe(
      "Bitte den Hintereingang benutzen, nach 10 Uhr klingeln",
    );
    const body = JSON.parse(
      (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    );
    expect(body).toEqual({ text: ["請使用後門"], source_lang: "ZH", target_lang: "DE" });
  });

  it("derives Hant targets from the ZH-HANS answer with OpenCC (one call)", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(fixture("deepl-pasta.json")));
    const t = make(fetchFn as never);
    expect(await t.translate("Spaghetti", "de", "zh-Hant-HK")).toBe("意大利麪");
    expect(await t.translate("Spaghetti", "de", "zh-Hant-TW")).toBe("義大利麵");
    // Every call asked DeepL for ZH-HANS, never for a Hant target.
    for (const call of fetchFn.mock.calls) {
      const body = JSON.parse((call as unknown as [string, RequestInit])[1].body as string);
      expect(body.target_lang).toBe("ZH-HANS");
    }
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("does not call DeepL for Chinese -> Chinese or the same locale", async () => {
    const fetchFn = vi.fn();
    const t = make(fetchFn as never);
    expect(await t.translate("意大利面", "zh-Hans", "zh-Hant-HK")).toBe("意大利麪");
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

  it("uses DeepL when a key is set", () => {
    expect(getTranslator({ DEEPL_API_KEY: "abc:fx" }).kind).toBe("deepl");
  });
});
