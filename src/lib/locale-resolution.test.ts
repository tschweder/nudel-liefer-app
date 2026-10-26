import { describe, expect, it } from "vitest";

import { matchAcceptLanguage, resolveLocale } from "./locale-resolution";

describe("matchAcceptLanguage", () => {
  it.each([
    ["zh-CN", "zh-Hans"],
    ["zh-SG", "zh-Hans"],
    ["zh-HK", "zh-Hans"],
    ["zh-TW", "zh-Hans"],
    ["zh-Hant", "zh-Hans"],
    ["de-AT", "de"],
    ["en-GB", "en"],
    ["en-US", "en"],
    ["sr", "sr-Latn"],
    ["sr-RS", "sr-Latn"],
    ["sr-Cyrl-RS", "sr-Latn"],
    ["cs", "cs"],
    ["cs-CZ", "cs"],
  ])("maps %s to %s", (tag, expected) => {
    expect(matchAcceptLanguage(tag)).toBe(expected);
  });

  it("respects q-values and skips unsupported languages", () => {
    expect(matchAcceptLanguage("fr;q=0.9, cs;q=0.8, de;q=0.5")).toBe("cs");
    expect(matchAcceptLanguage("de;q=0.2, sr-RS;q=0.9")).toBe("sr-Latn");
    expect(matchAcceptLanguage("fr, es")).toBeNull();
    expect(matchAcceptLanguage(null)).toBeNull();
  });
});

describe("resolveLocale", () => {
  it("prefers user locale over cookie over Accept-Language over de", () => {
    const acceptLanguage = "cs-CZ";
    expect(resolveLocale({ userLocale: "zh-Hans", cookie: "de", acceptLanguage })).toBe("zh-Hans");
    expect(resolveLocale({ cookie: "sr-Latn", acceptLanguage })).toBe("sr-Latn");
    expect(resolveLocale({ acceptLanguage })).toBe("cs");
    expect(resolveLocale({ acceptLanguage: "fr" })).toBe("de");
    expect(resolveLocale({})).toBe("de");
  });

  it("ignores invalid stored values", () => {
    expect(resolveLocale({ userLocale: "xx", cookie: "yy", acceptLanguage: "zh-CN" })).toBe(
      "zh-Hans",
    );
  });
});
