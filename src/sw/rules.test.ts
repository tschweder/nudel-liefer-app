import { describe, expect, it } from "vitest";

import { LOCALES } from "@/lib/localized-text";

import { isDriverNavigation, isDriverPath, isPrecachedStaticPath, SW_LOCALES } from "./rules";

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

  it("only build assets are precached by path", () => {
    expect(isPrecachedStaticPath("/_next/static/chunks/a.js")).toBe(true);
    expect(isPrecachedStaticPath("/de/driver")).toBe(false);
    expect(isPrecachedStaticPath("/api/driver/tour/today")).toBe(false);
  });
});
