import { describe, expect, it } from "vitest";

import { createLocalizedText, localizedTextSchema } from "./localized-text";
import { withDerivedHant } from "./localized-text.server";

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
