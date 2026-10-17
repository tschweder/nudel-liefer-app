import { describe, expect, it } from "vitest";

import {
  createLocalizedText,
  dbLocaleToTag,
  LOCALES,
  localizedTextSchema,
  pick,
  tagToDbLocale,
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
