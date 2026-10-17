import { describe, expect, it } from "vitest";

import {
  createLocalizedText,
  dbLocaleToTag,
  LOCALES,
  localizedTextSchema,
  pick,
  tagToDbLocale,
  withDerivedHant,
} from "./localized-text";

describe("LocalizedText", () => {
  it("validates a well-formed value and rejects a malformed one", () => {
    const text = createLocalizedText({ de: "Nudeln" }, "de");
    expect(localizedTextSchema.safeParse(text).success).toBe(true);
    expect(localizedTextSchema.safeParse({ de: "x" }).success).toBe(false);
    expect(
      localizedTextSchema.safeParse({ de: "x", meta: { source: "fr", machine: {}, updatedAt: "" } })
        .success,
    ).toBe(false);
  });

  it("returns the requested locale when present", () => {
    const text = createLocalizedText({ de: "Nudeln", "zh-Hans": "面", "zh-Hant-TW": "麵" }, "de");
    expect(pick(text, "de")).toBe("Nudeln");
    expect(pick(text, "zh-Hans")).toBe("面");
    expect(pick(text, "zh-Hant-TW")).toBe("麵");
  });

  it("falls back HK <-> TW, then Hans, then de, then source", () => {
    const tw = createLocalizedText({ de: "Nudeln", "zh-Hant-TW": "麵", "zh-Hans": "面" }, "de");
    expect(pick(tw, "zh-Hant-HK")).toBe("麵");
    const hansOnly = createLocalizedText({ de: "Nudeln", "zh-Hans": "面" }, "de");
    expect(pick(hansOnly, "zh-Hant-HK")).toBe("面");
    const hk = createLocalizedText({ de: "Nudeln", "zh-Hant-HK": "麵" }, "de");
    expect(pick(hk, "zh-Hans")).toBe("麵");
    const deOnly = createLocalizedText({ de: "Nudeln", "zh-Hans": "  " }, "de");
    expect(pick(deOnly, "zh-Hans")).toBe("Nudeln");
    const sourceOnly = createLocalizedText({ "zh-Hans": "面" }, "zh-Hans");
    expect(pick(sourceOnly, "de")).toBe("面");
    expect(pick(createLocalizedText({}, "de"), "de")).toBe("");
  });

  it("maps Prisma enum names to BCP-47 tags and back", () => {
    for (const tag of LOCALES) expect(dbLocaleToTag(tagToDbLocale(tag))).toBe(tag);
    expect(tagToDbLocale("zh-Hant-HK")).toBe("zh_Hant_HK");
  });
});

describe("withDerivedHant", () => {
  it("derives HK and TW Traditional forms from Hans and flags them as machine-made", () => {
    const text = createLocalizedText({ de: "Nudeln", "zh-Hans": "意大利面" }, "de");
    const result = withDerivedHant(text, new Date("2026-10-17T10:00:00Z"));
    expect(result["zh-Hant-HK"]).toBe("意大利麪");
    expect(result["zh-Hant-TW"]).toBe("義大利麵");
    expect(result.meta.machine).toEqual({ "zh-Hant-HK": true, "zh-Hant-TW": true });
    expect(result.meta.updatedAt).toBe("2026-10-17T10:00:00.000Z");
    expect(localizedTextSchema.safeParse(result).success).toBe(true);
  });

  it("never overwrites hand-entered variants", () => {
    const text = createLocalizedText({ "zh-Hans": "面条", "zh-Hant-TW": "手工麵" }, "zh-Hans");
    const result = withDerivedHant(text);
    expect(result["zh-Hant-TW"]).toBe("手工麵");
    expect(result["zh-Hant-HK"]).toBe("麪條");
    expect(result.meta.machine["zh-Hant-TW"]).toBeUndefined();
  });

  it("derives Hans from a Hant variant when only Hant exists", () => {
    const text = createLocalizedText({ "zh-Hant-TW": "麵條" }, "zh-Hant-TW");
    const result = withDerivedHant(text);
    expect(result["zh-Hans"]).toBe("面条");
    expect(result["zh-Hant-HK"]).toBe("麪條");
    expect(result.meta.machine["zh-Hans"]).toBe(true);
  });

  it("returns the input unchanged when there is nothing to derive", () => {
    const deOnly = createLocalizedText({ de: "Nudeln" }, "de");
    expect(withDerivedHant(deOnly)).toBe(deOnly);
    const full = createLocalizedText(
      { "zh-Hans": "面", "zh-Hant-HK": "麵", "zh-Hant-TW": "麵" },
      "zh-Hans",
    );
    expect(withDerivedHant(full)).toBe(full);
  });
});
