import { describe, expect, it } from "vitest";

import { buildOfflineHtml, OFFLINE_LOCALES, type OfflineTexts } from "./offline-page";

const texts = Object.fromEntries(
  OFFLINE_LOCALES.map((l) => [l, { title: `T-${l}`, text: `X-${l} <b>`, retry: `R-${l}` }]),
) as Record<(typeof OFFLINE_LOCALES)[number], OfflineTexts>;

describe("buildOfflineHtml", () => {
  const html = buildOfflineHtml(texts, "#9a3412");

  it("contains the texts of all four locales, escaped", () => {
    for (const l of OFFLINE_LOCALES) {
      expect(html).toContain(`lang="${l}"`);
      expect(html).toContain(`T-${l}`);
      expect(html).toContain(`R-${l}`);
    }
    expect(html).toContain("X-de &lt;b&gt;");
    expect(html).not.toContain("<b>");
  });

  it("is static and generic: no external resources, no session data", () => {
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/<(link|img|iframe)\b/);
  });
});
