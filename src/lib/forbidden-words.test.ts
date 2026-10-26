import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Glossary §3 (amended 2026-10-26): words that must not appear in any UI string.
 * - "Pin" / "Kartenpunkt" (the map point is "Adresspunkt"; the driver login "PIN" is a different thing),
 * - "Position(en)" for order lines (they are "Produkte"),
 * - "Kiste" / "Packung" (units are Beutel and Karton).
 * zh-Hant files are generated from zh-Hans, so the sources are enough.
 */
const FORBIDDEN: { word: RegExp; hint: string }[] = [
  { word: /\bPins?\b/, hint: '"Pin" (use Adresspunkt / Parkplatz / Standort)' },
  { word: /Kartenpunkt/i, hint: '"Kartenpunkt"' },
  { word: /\bPositionen?\b|Kartenposition/, hint: '"Position(en)" (use Produkt/Produkte)' },
  { word: /\bKisten?\b/, hint: '"Kiste" (use Karton)' },
  { word: /Packung/, hint: '"Packung" (use Beutel)' },
  { word: /箱子|筐/, hint: "箱子/筐 (use 纸箱)" },
];

function strings(value: unknown, trail = ""): [string, string][] {
  if (typeof value === "string") return [[trail, value]];
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => strings(v, trail ? `${trail}.${k}` : k));
  }
  return [];
}

describe("UI wording (glossary §3)", () => {
  for (const locale of ["de", "zh-Hans"]) {
    it(`${locale}.json contains none of the retired words`, () => {
      const messages = JSON.parse(
        readFileSync(path.join(process.cwd(), "messages", `${locale}.json`), "utf8"),
      );
      const hits = strings(messages).flatMap(([key, text]) =>
        FORBIDDEN.filter((f) => f.word.test(text)).map((f) => `${key}: ${f.hint} in "${text}"`),
      );
      expect(hits).toEqual([]);
    });
  }
});
