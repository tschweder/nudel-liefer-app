import { describe, expect, it } from "vitest";

import { LOCALES } from "@/lib/localized-text";

import {
  isDriverLaunchPath,
  isDriverNavigation,
  isDriverPath,
  isOfflineShellRoute,
  isPhotoCachePath,
  isPrecachedStaticPath,
  isTileRequest,
  offlineShellUrl,
  offlineShellUrls,
  SW_LOCALES,
  tileUrlPattern,
} from "./rules";

const nav = { mode: "navigate" };
const url = (path: string) => new URL(path, "https://app.test");

describe("service worker rules", () => {
  it("knows exactly the app locales", () => {
    expect([...SW_LOCALES]).toEqual([...LOCALES]);
  });

  it("recognises driver pages in every locale", () => {
    for (const p of ["/de/driver", "/zh-Hans/driver/stops/abc", "/zh-Hant-HK/driver/login"]) {
      expect(isDriverPath(p)).toBe(true);
    }
  });

  it("does not touch admin pages, APIs or lookalikes", () => {
    for (const p of ["/de/admin", "/api/driver/tour/today", "/de/driverx", "/driver", "/de"]) {
      expect(isDriverPath(p)).toBe(false);
    }
  });

  it("treats only page loads (navigate) of the driver area as network-only navigations", () => {
    expect(isDriverNavigation(nav, url("/de/driver"))).toBe(true);
    expect(isDriverNavigation({ mode: "cors" }, url("/de/driver"))).toBe(false);
    expect(isDriverNavigation(nav, url("/de/admin"))).toBe(false);
  });

  it("treats the locale-neutral start URL as a driver navigation, but not as a shell route (NUD-106)", () => {
    expect(isDriverNavigation(nav, url("/driver?source=pwa"))).toBe(true);
    expect(isDriverNavigation(nav, url("/driver"))).toBe(true);
    expect(isDriverNavigation({ mode: "cors" }, url("/driver"))).toBe(false);
    expect(isDriverLaunchPath("/driver")).toBe(true);
    expect(isDriverLaunchPath("/driverx")).toBe(false);
    expect(isDriverLaunchPath("/driver/stops/1")).toBe(false);
    expect(isOfflineShellRoute("/driver")).toBe(false);
    expect(offlineShellUrl("/driver")).toBeNull();
  });

  it("only build assets are precached by path", () => {
    expect(isPrecachedStaticPath("/_next/static/chunks/a.js")).toBe(true);
    expect(isPrecachedStaticPath("/de/driver")).toBe(false);
    expect(isPrecachedStaticPath("/api/driver/tour/today")).toBe(false);
  });
});

describe("service worker rules for the offline copy (NUD-081)", () => {
  it("serves the shell for the tour list and stop details only", () => {
    expect(offlineShellUrl("/de/driver")).toBe("/de/driver/offline-shell");
    expect(offlineShellUrl("/zh-Hant-TW/driver/stops/abc")).toBe(
      "/zh-Hant-TW/driver/offline-shell",
    );
    expect(offlineShellUrl("/de/driver/")).toBe("/de/driver/offline-shell");
    for (const p of [
      "/de/driver/login",
      "/de/driver/start",
      "/de/driver/stops",
      "/de/driver/stops/a/b",
      "/de/admin",
      "/api/driver/tour/today",
    ]) {
      expect(offlineShellUrl(p)).toBeNull();
      expect(isOfflineShellRoute(p)).toBe(false);
    }
  });

  it("precaches one shell per locale", () => {
    expect(offlineShellUrls()).toEqual(LOCALES.map((l) => `/${l}/driver/offline-shell`));
  });

  it("answers photo cache URLs from the cache only", () => {
    expect(isPhotoCachePath("/api/driver/photo-cache/abc")).toBe(true);
    expect(isPhotoCachePath("/api/driver/photo-cache/")).toBe(false);
    expect(isPhotoCachePath("/api/driver/tour/today")).toBe(false);
  });
});

describe("tile cache matcher (NUD-108)", () => {
  const pattern = tileUrlPattern("https://{s}.tiles.example/v1/{z}/{x}/{y}{r}.png?key=K1");

  it("matches the tiles of the configured provider only", () => {
    expect(isTileRequest("https://a.tiles.example/v1/13/4256/2680.png?key=K1", pattern)).toBe(true);
    expect(isTileRequest("https://b.tiles.example/v1/13/4256/2680@2x.png?key=K1", pattern)).toBe(
      true,
    );
    expect(isTileRequest("https://a.tiles.example/v1/13/4256/2680.png?key=OTHER", pattern)).toBe(
      false,
    );
    expect(isTileRequest("https://evil.example/v1/13/4256/2680.png?key=K1", pattern)).toBe(false);
    expect(isTileRequest("https://a.tiles.example/api/driver/tour/today", pattern)).toBe(false);
  });

  it("does nothing without a usable http(s) URL", () => {
    expect(tileUrlPattern("")).toBeNull();
    expect(tileUrlPattern("/relative/{z}/{x}/{y}.png")).toBeNull();
    expect(isTileRequest("https://a.tiles.example/1/2/3.png", null)).toBe(false);
  });
});
