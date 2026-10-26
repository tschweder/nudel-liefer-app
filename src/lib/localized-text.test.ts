import { describe, expect, it } from "vitest";

import {
  ADMIN_LOCALES,
  createLocalizedText,
  dbLocaleToTag,
  LOCALES,
  localizedTextSchema,
  pick,
  pickWithSource,
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
    const text = createLocalizedText(
      { de: "Nudeln", en: "Noodles", "sr-Latn": "Nudle", cs: "Nudle", "zh-Hans": "面" },
      "de",
    );
    expect(pick(text, "de")).toBe("Nudeln");
    expect(pick(text, "en")).toBe("Noodles");
    expect(pick(text, "sr-Latn")).toBe("Nudle");
    expect(pick(text, "zh-Hans")).toBe("面");
  });

  it("falls back to de, then the source locale", () => {
    const deOnly = createLocalizedText({ de: "Nudeln", "zh-Hans": "  " }, "de");
    expect(pick(deOnly, "zh-Hans")).toBe("Nudeln");
    expect(pick(deOnly, "sr-Latn")).toBe("Nudeln");
    const enMissing = createLocalizedText({ de: "Nudeln", cs: "Nudle" }, "de");
    expect(pick(enMissing, "en")).toBe("Nudeln");
    const sourceOnly = createLocalizedText({ "zh-Hans": "面" }, "zh-Hans");
    expect(pick(sourceOnly, "de")).toBe("面");
    expect(pick(createLocalizedText({}, "de"), "de")).toBe("");
  });

  it("maps Prisma enum names to BCP-47 tags and back", () => {
    for (const tag of LOCALES) expect(dbLocaleToTag(tagToDbLocale(tag))).toBe(tag);
    expect(tagToDbLocale("sr-Latn")).toBe("sr_Latn");
    expect(tagToDbLocale("zh-Hans")).toBe("zh_Hans");
  });

  it("has exactly the five languages of D21", () => {
    expect([...LOCALES]).toEqual(["de", "en", "sr-Latn", "cs", "zh-Hans"]);
    expect([...ADMIN_LOCALES]).toEqual(["de", "en", "zh-Hans"]);
  });
});

describe("pickWithSource", () => {
  const base = { meta: { source: "de" as const, machine: {}, updatedAt: "x" } };
  it("says which language the picked text is in", () => {
    expect(pickWithSource({ ...base, de: "Hallo" }, "zh-Hans")).toEqual({
      value: "Hallo",
      locale: "de",
    });
    expect(pickWithSource({ ...base, de: "Hallo", cs: "Ahoj" }, "cs")).toEqual({
      value: "Ahoj",
      locale: "cs",
    });
  });
  it("is null when nothing is set", () => {
    expect(pickWithSource({ ...base, de: "  " }, "de")).toBeNull();
  });
});
