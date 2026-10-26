import { describe, expect, it } from "vitest";

import { type LocalizedText } from "./localized-text";
import { productLabel } from "./product-label";

const name: LocalizedText = {
  de: "Spaghetti 5 kg",
  "zh-Hans": "意大利面 5 公斤",
  en: "Spaghetti 5 kg (EN)",
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
    expect(productLabel(name, "SPAG-5", "en").primary).toBe("Spaghetti 5 kg (EN)");
  });

  it("falls back to German and does not repeat the German name", () => {
    // no Czech text: the German name is the fallback
    expect(productLabel(name, "SPAG-5", "cs").primary).toBe("Spaghetti 5 kg");
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
