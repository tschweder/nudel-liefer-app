import { describe, expect, it } from "vitest";

import { ABBREVIATION_MAX, normalizeAbbreviation } from "./customer-abbreviation";

describe("normalizeAbbreviation", () => {
  it("keeps special characters and trims surrounding spaces", () => {
    expect(normalizeAbbreviation("  Ä/ß-#1 ")).toBe("Ä/ß-#1");
  });

  it("stores blank or missing text as null", () => {
    expect(normalizeAbbreviation("   ")).toBeNull();
    expect(normalizeAbbreviation(null)).toBeNull();
    expect(normalizeAbbreviation(undefined)).toBeNull();
  });

  it("refuses text above the maximum", () => {
    expect(normalizeAbbreviation("x".repeat(ABBREVIATION_MAX))).toBe("x".repeat(ABBREVIATION_MAX));
    expect(normalizeAbbreviation("x".repeat(ABBREVIATION_MAX + 1))).toBeUndefined();
  });
});
