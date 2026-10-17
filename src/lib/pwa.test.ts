import { describe, expect, it } from "vitest";

import de from "../../messages/de.json";
import zhHans from "../../messages/zh-Hans.json";
import zhHantHK from "../../messages/zh-Hant-HK.json";
import zhHantTW from "../../messages/zh-Hant-TW.json";
import { LOCALES } from "./localized-text";
import { buildManifest, driverHomePath, manifestPath, PWA_ICONS } from "./pwa";

const messages = { de, "zh-Hans": zhHans, "zh-Hant-HK": zhHantHK, "zh-Hant-TW": zhHantTW };

describe("buildManifest", () => {
  for (const locale of LOCALES) {
    it(`is valid and starts on the driver home for ${locale}`, () => {
      const pwa = messages[locale as keyof typeof messages].pwa;
      const m = buildManifest({
        locale,
        name: pwa.name,
        shortName: pwa.shortName,
        description: pwa.description,
      });
      expect(m.start_url).toBe(`/${locale}/driver`);
      expect(m.start_url).toBe(driverHomePath(locale));
      expect(m.start_url.startsWith(m.scope)).toBe(true);
      expect(m.display).toBe("standalone");
      expect(m.lang).toBe(locale);
      expect(m.name.length).toBeGreaterThan(0);
      expect(m.short_name.length).toBeGreaterThan(0);
      expect(m.short_name.length).toBeLessThanOrEqual(12);
      expect(m.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(m.background_color).toMatch(/^#[0-9a-f]{6}$/i);
    });
  }

  it("has icons 192 and 512 plus maskable ones", () => {
    const m = buildManifest({ locale: "de", name: "n", shortName: "s", description: "d" });
    const find = (sizes: string, purpose: string) =>
      m.icons.find((i) => i.sizes === sizes && i.purpose === purpose);
    expect(find("192x192", "any")?.src).toBe(PWA_ICONS.any192);
    expect(find("512x512", "any")?.src).toBe(PWA_ICONS.any512);
    expect(find("512x512", "maskable")?.src).toBe(PWA_ICONS.maskable512);
    expect(m.icons.every((i) => i.type === "image/png")).toBe(true);
  });

  it("uses one app id for all locales (one installed app)", () => {
    const ids = LOCALES.map(
      (locale) => buildManifest({ locale, name: "n", shortName: "s", description: "d" }).id,
    );
    expect(new Set(ids).size).toBe(1);
  });

  it("links a per-locale manifest path", () => {
    expect(manifestPath("zh-Hant-TW")).toBe("/zh-Hant-TW/manifest.webmanifest");
  });
});
