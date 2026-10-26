import { describe, expect, it } from "vitest";

import { localeRedirectPath } from "./locale-redirect";

const launch = { pathname: "/driver", search: "?source=pwa" };

describe("localeRedirectPath (NUD-106: installed app start URL)", () => {
  it("sends the launch URL to the session locale, ignoring the locale the app was installed in", () => {
    expect(localeRedirectPath({ ...launch, userLocale: "de", cookie: "cs" })).toBe(
      "/de/driver?source=pwa",
    );
    expect(localeRedirectPath({ ...launch, userLocale: "zh-Hans" })).toBe(
      "/zh-Hans/driver?source=pwa",
    );
  });

  it("without a session uses the cookie, then Accept-Language, then German", () => {
    expect(localeRedirectPath({ ...launch, cookie: "sr-Latn", acceptLanguage: "de-AT" })).toBe(
      "/sr-Latn/driver?source=pwa",
    );
    expect(localeRedirectPath({ ...launch, acceptLanguage: "cs-CZ,cs;q=0.8" })).toBe(
      "/cs/driver?source=pwa",
    );
    expect(localeRedirectPath({ ...launch })).toBe("/de/driver?source=pwa");
  });

  it("ignores an invalid user locale or cookie", () => {
    expect(localeRedirectPath({ ...launch, userLocale: "xx", cookie: "zh-Hans" })).toBe(
      "/zh-Hans/driver?source=pwa",
    );
    expect(localeRedirectPath({ ...launch, cookie: "klingon" })).toBe("/de/driver?source=pwa");
  });

  it("sends a driver-only language opening an office page to the German page", () => {
    expect(localeRedirectPath({ pathname: "/admin/orders", search: "", userLocale: "cs" })).toBe(
      "/de/admin/orders",
    );
    expect(localeRedirectPath({ pathname: "/admin", search: "", userLocale: "en" })).toBe(
      "/en/admin",
    );
  });

  it("keeps deep paths and the root", () => {
    expect(localeRedirectPath({ pathname: "/", search: "", cookie: "zh-Hans" })).toBe("/zh-Hans");
    expect(localeRedirectPath({ pathname: "/driver/stops/7", search: "", userLocale: "de" })).toBe(
      "/de/driver/stops/7",
    );
  });
});
