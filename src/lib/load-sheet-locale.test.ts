import { describe, expect, it } from "vitest";

import { parseSheetLocale, SHEET_LOCALE_OPTIONS } from "./load-sheet-locale";

describe("parseSheetLocale", () => {
  it("keeps German", () => {
    expect(parseSheetLocale("de")).toBe("de");
  });

  it("folds every Chinese tag onto the simplified sheet", () => {
    for (const raw of ["zh-Hans", "zh", "zh-Hant-HK", "zh-Hant-TW"]) {
      expect(parseSheetLocale(raw)).toBe("zh-Hans");
    }
  });

  it("falls back to German for a missing value", () => {
    expect(parseSheetLocale(undefined)).toBe("de");
    expect(parseSheetLocale(null)).toBe("de");
  });

  it("falls back to German for an empty or blank string", () => {
    expect(parseSheetLocale("")).toBe("de");
    expect(parseSheetLocale("   ")).toBe("de");
  });

  it("falls back to German for a repeated (array) value", () => {
    expect(parseSheetLocale(["zh-Hant-TW", "de"])).toBe("de");
    expect(parseSheetLocale(["de"])).toBe("de");
  });

  it("falls back to German for a non-string", () => {
    expect(parseSheetLocale(42)).toBe("de");
    expect(parseSheetLocale({ locale: "zh" })).toBe("de");
    expect(parseSheetLocale(true)).toBe("de");
  });

  it("falls back to German for other languages and junk", () => {
    for (const raw of ["en", "ZH-HANS", "de-DE", "German"]) {
      expect(parseSheetLocale(raw)).toBe("de");
    }
  });
});

describe("SHEET_LOCALE_OPTIONS", () => {
  it("offers exactly the two printout languages, in order", () => {
    expect(SHEET_LOCALE_OPTIONS).toEqual([
      { value: "de", label: "Deutsch" },
      { value: "zh-Hans", label: "中文" },
    ]);
  });
});
