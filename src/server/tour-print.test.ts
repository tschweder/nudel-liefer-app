import { describe, expect, it } from "vitest";

import { parsePrintLocale, parseTourId } from "./tour-print";

describe("parsePrintLocale", () => {
  it("accepts exactly the four app locales", () => {
    for (const l of ["de", "zh-Hans", "zh-Hant-HK", "zh-Hant-TW"] as const) {
      expect(parsePrintLocale(l, "de")).toBe(l);
    }
    expect(parsePrintLocale(["zh-Hans", "de"], "de")).toBe("zh-Hans");
  });

  it("falls back to the page locale for anything else", () => {
    for (const bad of [
      undefined,
      "",
      "en",
      "zh",
      "ZH-HANS",
      "zh-hans",
      " de",
      "de ",
      "../x",
      5,
      null,
      [],
    ]) {
      expect(parsePrintLocale(bad, "zh-Hant-TW")).toBe("zh-Hant-TW");
    }
  });
});

describe("parseTourId", () => {
  it("accepts a short non-empty id and rejects the rest", () => {
    expect(parseTourId("clx123")).toBe("clx123");
    expect(parseTourId("")).toBeNull();
    expect(parseTourId("   ")).toBeNull();
    expect(parseTourId("x".repeat(65))).toBeNull();
    expect(parseTourId(undefined)).toBeNull();
    expect(parseTourId({ id: 1 })).toBeNull();
  });
});
