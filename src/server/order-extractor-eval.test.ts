import { describe, expect, it } from "vitest";

import { evaluateSamples, loadSamples } from "../../scripts/order-extractor-eval";
import { FakeOrderExtractor } from "./order-extractor";

/**
 * Guards the evaluation fixture (NUD-150 acceptance criterion: an evaluation script with >= 15
 * sample messages that reports the line accuracy). The fake reads them all correctly, so a change
 * to the matcher or to a sample shows up here before it shows up in the accuracy report.
 */
describe("order-extraction evaluation fixture", () => {
  const samples = loadSamples();
  const today = "2026-10-28";

  it("has at least 15 anonymised samples in German and Chinese", () => {
    expect(samples.length).toBeGreaterThanOrEqual(15);
    expect(new Set(samples.map((sample) => sample.locale))).toEqual(new Set(["de", "zh-Hans"]));
  });

  it("has no customer names, addresses or phone numbers in the sample texts", () => {
    for (const sample of samples) {
      expect(sample.text).not.toMatch(/\d{4,}/); // no house numbers, phone numbers or customer ids
      expect(sample.text).not.toMatch(/@|www\.|\.at\b/i);
    }
  });

  it("is read correctly line by line by the offline extractor", async () => {
    const results = await evaluateSamples(samples, {
      extractor: new FakeOrderExtractor(),
      today,
    });
    const misses = results.filter((result) => !result.exact);
    expect(misses.map((miss) => `${miss.id}: ${miss.actual} != ${miss.expected}`)).toEqual([]);
  });

  it("resolves the relative days to the reference day", async () => {
    const results = await evaluateSamples(samples, {
      extractor: new FakeOrderExtractor(),
      today,
    });
    const windowCases = results.filter((result) => result.windowOk !== null);
    expect(windowCases.length).toBeGreaterThan(0);
    expect(windowCases.filter((result) => result.windowOk === false).map((r) => r.id)).toEqual([]);
  });
});
