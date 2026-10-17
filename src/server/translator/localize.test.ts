// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { createLocalizedText, localizedTextSchema, pick } from "@/lib/localized-text";

import { FakeTranslator } from "./fake";
import { completeTranslation, localize } from "./localize";
import { type Translator, TranslatorError } from "./types";

const NOW = new Date("2026-10-17T10:00:00Z");
const NOTE = "Hintereingang benutzen, nach 10 Uhr klingeln";

/** A provider that is down. */
const failing = (
  code: "TIMEOUT" | "HTTP" | "INVALID_INPUT" = "HTTP",
): Translator & { calls: number } => ({
  kind: "deepl",
  calls: 0,
  async translate() {
    this.calls++;
    throw new TranslatorError("down", code, code === "HTTP" ? 503 : undefined);
  },
});

describe("localize", () => {
  it("fills all four locales from a German source and flags machine output", async () => {
    const text = await localize(` ${NOTE} `, "de", { translator: new FakeTranslator(), now: NOW });
    expect(localizedTextSchema.safeParse(text).success).toBe(true);
    expect(text.de).toBe(NOTE);
    expect(text["zh-Hans"]).toBe(`[zh-Hans] ${NOTE}`);
    expect(text["zh-Hant-HK"]).toBe(`[zh-Hans] ${NOTE}`);
    expect(text["zh-Hant-TW"]).toBe(`[zh-Hans] ${NOTE}`);
    expect(text.meta).toEqual({
      source: "de",
      machine: { "zh-Hans": true, "zh-Hant-HK": true, "zh-Hant-TW": true },
      updatedAt: NOW.toISOString(),
    });
    expect(text.meta.pendingTranslation).toBeUndefined();
  });

  it("converts Hant variants with OpenCC (one provider call)", async () => {
    const translate = vi.fn(async () => "意大利面");
    const t: Translator = { kind: "deepl", translate };
    const text = await localize("Spaghetti", "de", { translator: t, now: NOW });
    expect(translate).toHaveBeenCalledTimes(1);
    expect(translate).toHaveBeenCalledWith("Spaghetti", "de", "zh-Hans");
    expect(text["zh-Hans"]).toBe("意大利面");
    expect(text["zh-Hant-HK"]).toBe("意大利麪");
    expect(text["zh-Hant-TW"]).toBe("義大利麵");
  });

  it("translates a Chinese source to German and derives the other Chinese variants", async () => {
    const translate = vi.fn(async () => "Hintereingang");
    const t: Translator = { kind: "deepl", translate };
    const hans = await localize("意大利面", "zh-Hans", { translator: t, now: NOW });
    expect(translate).toHaveBeenCalledWith("意大利面", "zh-Hans", "de");
    expect(hans.de).toBe("Hintereingang");
    expect(hans["zh-Hant-TW"]).toBe("義大利麵");
    expect(hans.meta.machine).toEqual({ de: true, "zh-Hant-HK": true, "zh-Hant-TW": true });
    expect(hans.meta.source).toBe("zh-Hans");

    const hk = await localize("意大利麪", "zh-Hant-HK", { translator: t, now: NOW });
    expect(hk["zh-Hant-HK"]).toBe("意大利麪");
    expect(hk["zh-Hans"]).toBe("意大利面");
    expect(hk.de).toBe("Hintereingang");
    // The source locale is never flagged as machine output.
    expect(hk.meta.machine["zh-Hant-HK"]).toBeUndefined();
    expect(pick(hk, "de")).toBe("Hintereingang");
  });

  it("never throws when the provider is down: stores the source and marks it pending", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = failing();
    const text = await localize(NOTE, "de", { translator: t, now: NOW });
    expect(text.de).toBe(NOTE);
    expect(text["zh-Hans"]).toBeUndefined();
    expect(text["zh-Hant-HK"]).toBeUndefined();
    expect(text.meta.pendingTranslation).toBe(true);
    expect(text.meta.machine).toEqual({});
    expect(localizedTextSchema.safeParse(text).success).toBe(true);
    expect(pick(text, "zh-Hans")).toBe(NOTE); // read rule: falls back to German
  });

  it("keeps the offline OpenCC variants of a Chinese source when only German is pending", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const text = await localize("意大利面", "zh-Hans", {
      translator: failing("TIMEOUT"),
      now: NOW,
    });
    expect(text.de).toBeUndefined();
    expect(text["zh-Hant-TW"]).toBe("義大利麵");
    expect(text.meta.pendingTranslation).toBe(true);
  });

  it("does not log the text when the provider fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await localize("geheimer Hinweis", "de", { translator: failing(), now: NOW });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).not.toContain("geheimer");
  });

  it("treats an empty provider answer as a failure", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const t: Translator = { kind: "deepl", translate: async () => "  " };
    const text = await localize("Hallo", "de", { translator: t, now: NOW });
    expect(text.meta.pendingTranslation).toBe(true);
    expect(text["zh-Hans"]).toBeUndefined();
  });

  it("does not call the provider for empty text", async () => {
    const t = failing();
    const text = await localize("   ", "de", { translator: t, now: NOW });
    expect(t.calls).toBe(0);
    expect(text.de).toBe("");
    expect(text.meta.pendingTranslation).toBeUndefined();
  });
});

describe("completeTranslation", () => {
  const pending = (values: Parameters<typeof createLocalizedText>[0]) =>
    createLocalizedText(values, "de", { now: NOW, pendingTranslation: true });

  it("fills the missing locales, clears the flag and bumps updatedAt", async () => {
    const later = new Date("2026-10-17T10:10:00Z");
    const done = await completeTranslation(pending({ de: NOTE }), new FakeTranslator(), later);
    expect(done.meta.pendingTranslation).toBeUndefined();
    expect(done.meta.updatedAt).toBe(later.toISOString());
    expect(done["zh-Hans"]).toBe(`[zh-Hans] ${NOTE}`);
  });

  it("never overwrites a hand-written locale", async () => {
    const t: Translator = { kind: "deepl", translate: vi.fn(async () => "机器翻译") };
    const done = await completeTranslation(pending({ de: NOTE, "zh-Hant-HK": "手寫版本" }), t, NOW);
    expect(done["zh-Hant-HK"]).toBe("手寫版本");
    // Hans is derived from the existing Hant text, no provider call needed.
    expect(done["zh-Hans"]).toBe("手写版本");
    expect(t.translate).not.toHaveBeenCalled();
    expect(done.meta.machine["zh-Hant-HK"]).toBeUndefined();
  });

  it("propagates the provider error and leaves the input untouched", async () => {
    const input = pending({ de: NOTE });
    await expect(completeTranslation(input, failing(), NOW)).rejects.toBeInstanceOf(
      TranslatorError,
    );
    expect(input.meta.pendingTranslation).toBe(true);
  });

  it("just clears the flag when the source text is empty", async () => {
    const t = failing();
    const done = await completeTranslation(pending({ de: "" }), t, NOW);
    expect(t.calls).toBe(0);
    expect(done.meta.pendingTranslation).toBeUndefined();
  });
});
