import { describe, expect, it } from "vitest";

import { type LocalizedText } from "./localized-text";
import { productLabel } from "./product-label";

const name: LocalizedText = {
  de: "Spaghetti 5 kg",
  "zh-Hans": "意大利面 5 公斤",
  "zh-Hant-TW": "義大利麵 5 公斤",
  meta: { source: "de", machine: {}, updatedAt: "2026-01-01T00:00:00.000Z" },
};

describe("productLabel", () => {
  it("is German only on a German sheet", () => {
    expect(productLabel(name, "SPAG-5", "de")).toEqual({ primary: "Spaghetti 5 kg", german: null });
  });

  it("adds the German name to a Chinese sheet", () => {
    expect(productLabel(name, "SPAG-5", "zh-Hans")).toEqual({
      primary: "意大利面 5 公斤",
      german: "Spaghetti 5 kg",
    });
    expect(productLabel(name, "SPAG-5", "zh-Hant-TW").primary).toBe("義大利麵 5 公斤");
  });

  it("falls back along the usual chain and does not repeat the German name", () => {
    // HK has no text: TW is the closest Chinese variant
    expect(productLabel(name, "SPAG-5", "zh-Hant-HK").primary).toBe("義大利麵 5 公斤");
    const onlyGerman: LocalizedText = {
      de: "Penne",
      meta: { source: "de", machine: {}, updatedAt: "2026-01-01T00:00:00.000Z" },
    };
    expect(productLabel(onlyGerman, "PEN", "zh-Hans")).toEqual({ primary: "Penne", german: null });
  });

  it("shows the SKU when the name is unusable", () => {
    expect(productLabel(null, "SPAG-5", "zh-Hans")).toEqual({ primary: "SPAG-5", german: null });
  });
});
