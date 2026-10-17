import { describe, expect, it } from "vitest";

import { matchAcceptLanguage, resolveLocale } from "./locale-resolution";

describe("matchAcceptLanguage", () => {
  it.each([
    ["zh-CN", "zh-Hans"],
    ["zh-SG", "zh-Hans"],
    ["zh-HK", "zh-Hant-HK"],
    ["zh-MO", "zh-Hant-HK"],
    ["zh-TW", "zh-Hant-TW"],
    ["zh-Hant", "zh-Hant-TW"],
    ["de-AT", "de"],
  ])("maps %s to %s", (tag, expected) => {
    expect(matchAcceptLanguage(tag)).toBe(expected);
  });

  it("respects q-values and skips unsupported languages", () => {
    expect(matchAcceptLanguage("fr;q=0.9, zh-TW;q=0.8, de;q=0.5")).toBe("zh-Hant-TW");
    expect(matchAcceptLanguage("de;q=0.2, zh-HK;q=0.9")).toBe("zh-Hant-HK");
    expect(matchAcceptLanguage("fr, en-US")).toBeNull();
    expect(matchAcceptLanguage(null)).toBeNull();
  });
});

describe("resolveLocale", () => {
  it("prefers user locale over cookie over Accept-Language over de", () => {
    const acceptLanguage = "zh-TW";
    expect(resolveLocale({ userLocale: "zh-Hans", cookie: "de", acceptLanguage })).toBe("zh-Hans");
    expect(resolveLocale({ cookie: "zh-Hant-HK", acceptLanguage })).toBe("zh-Hant-HK");
    expect(resolveLocale({ acceptLanguage })).toBe("zh-Hant-TW");
    expect(resolveLocale({ acceptLanguage: "fr" })).toBe("de");
    expect(resolveLocale({})).toBe("de");
  });

  it("ignores invalid stored values", () => {
    expect(resolveLocale({ userLocale: "xx", cookie: "yy", acceptLanguage: "zh-CN" })).toBe(
      "zh-Hans",
    );
  });
});
