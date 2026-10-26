// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { createLocalizedText, localizedTextSchema, pick } from "@/lib/localized-text";

import { RoutedTranslator } from "./base";
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

/** DeepL without a Serbian provider: the production setup until NUD-150. */
const withoutSerbian = (
  inner: Translator = { kind: "deepl", translate: async (t, _f, to) => `${to}: ${t}` },
) => new RoutedTranslator(inner, undefined);

describe("localize", () => {
  it("fills all five locales from a German source and flags machine output", async () => {
    const text = await localize(` ${NOTE} `, "de", { translator: new FakeTranslator(), now: NOW });
    expect(localizedTextSchema.safeParse(text).success).toBe(true);
    expect(text.de).toBe(NOTE);
    expect(text.en).toBe(`[en] ${NOTE}`);
    expect(text["sr-Latn"]).toBe(`[sr-Latn] ${NOTE}`);
    expect(text.cs).toBe(`[cs] ${NOTE}`);
    expect(text["zh-Hans"]).toBe(`[zh-Hans] ${NOTE}`);
    expect(text.meta).toEqual({
      source: "de",
      machine: { en: true, "sr-Latn": true, cs: true, "zh-Hans": true },
      updatedAt: NOW.toISOString(),
    });
    expect(text.meta.pendingTranslation).toBeUndefined();
  });

  it("asks the provider once per missing target language", async () => {
    const translate = vi.fn(async (_t: string, _f: string, to: string) => `<${to}>`);
    const text = await localize("Spaghetti", "de", {
      translator: { kind: "deepl", translate } as Translator,
      now: NOW,
    });
    expect(translate).toHaveBeenCalledTimes(4);
    expect(translate).toHaveBeenCalledWith("Spaghetti", "de", "zh-Hans");
    expect(text.cs).toBe("<cs>");
  });

  it("translates a non-German source into all other languages and never flags the source", async () => {
    const translate = vi.fn(async (_t: string, _f: string, to: string) => `<${to}>`);
    const t: Translator = { kind: "deepl", translate };
    const hans = await localize("意大利面", "zh-Hans", { translator: t, now: NOW });
    expect(translate).toHaveBeenCalledWith("意大利面", "zh-Hans", "de");
    expect(hans.de).toBe("<de>");
    expect(hans.cs).toBe("<cs>");
    expect(hans["zh-Hans"]).toBe("意大利面");
    expect(hans.meta.machine).toEqual({ de: true, en: true, "sr-Latn": true, cs: true });
    expect(hans.meta.source).toBe("zh-Hans");
    expect(pick(hans, "de")).toBe("<de>");
  });

  it("never throws when the provider is down: stores the source and marks it pending", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = failing();
    const text = await localize(NOTE, "de", { translator: t, now: NOW });
    expect(text.de).toBe(NOTE);
    expect(text["zh-Hans"]).toBeUndefined();
    expect(text.cs).toBeUndefined();
    expect(text.meta.pendingTranslation).toBe(true);
    expect(text.meta.machine).toEqual({});
    expect(localizedTextSchema.safeParse(text).success).toBe(true);
    expect(pick(text, "zh-Hans")).toBe(NOTE); // read rule: falls back to German
  });

  it("keeps the languages that worked and stays pending when only some fail", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const t: Translator = {
      kind: "deepl",
      async translate(_t, _f, to) {
        if (to === "cs") throw new TranslatorError("down", "HTTP", 503);
        return `<${to}>`;
      },
    };
    const text = await localize("Nudeln", "de", { translator: t, now: NOW });
    expect(text.en).toBe("<en>");
    expect(text.cs).toBeUndefined();
    expect(text.meta.pendingTranslation).toBe(true);
    expect(text.meta.machine).toEqual({ en: true, "sr-Latn": true, "zh-Hans": true });
  });

  it("leaves Serbian empty (not pending) while no Serbian provider exists, other languages are filled", async () => {
    const text = await localize("Nudeln", "de", { translator: withoutSerbian(), now: NOW });
    expect(text.en).toBe("en: Nudeln");
    expect(text.cs).toBe("cs: Nudeln");
    expect(text["zh-Hans"]).toBe("zh-Hans: Nudeln");
    expect(text["sr-Latn"]).toBeUndefined();
    expect(text.meta.pendingTranslation).toBeUndefined();
    expect(pick(text, "sr-Latn")).toBe("Nudeln"); // falls back to German
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
    expect(done["sr-Latn"]).toBe(`[sr-Latn] ${NOTE}`);
  });

  it("never overwrites a hand-written locale and only asks for the missing ones", async () => {
    const translate = vi.fn(async (_t: string, _f: string, to: string) => `<${to}>`);
    const t: Translator = { kind: "deepl", translate };
    const done = await completeTranslation(pending({ de: NOTE, "zh-Hans": "手写版本" }), t, NOW);
    expect(done["zh-Hans"]).toBe("手写版本");
    expect(translate).toHaveBeenCalledTimes(3);
    expect(translate).not.toHaveBeenCalledWith(NOTE, "de", "zh-Hans");
    expect(done.meta.machine["zh-Hans"]).toBeUndefined();
  });

  it("can be limited to some target locales (a problem note only needs German)", async () => {
    const translate = vi.fn(async () => "Deutsch");
    const input = createLocalizedText({ "zh-Hans": "有问题" }, "zh-Hans", {
      now: NOW,
      pendingTranslation: true,
    });
    const done = await completeTranslation(input, { kind: "deepl", translate }, NOW, ["de"]);
    expect(translate).toHaveBeenCalledTimes(1);
    expect(done.de).toBe("Deutsch");
    expect(done.en).toBeUndefined();
    expect(done.meta.pendingTranslation).toBeUndefined();
  });

  it("propagates the provider error when nothing could be filled and leaves the input untouched", async () => {
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
