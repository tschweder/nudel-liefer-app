import { describe, expect, it } from "vitest";

import { localeRedirectPath } from "./locale-redirect";

const launch = { pathname: "/driver", search: "?source=pwa" };

describe("localeRedirectPath (NUD-106: installed app start URL)", () => {
  it("sends the launch URL to the session locale, ignoring the locale the app was installed in", () => {
    expect(localeRedirectPath({ ...launch, userLocale: "de", cookie: "zh-Hant-TW" })).toBe(
      "/de/driver?source=pwa",
    );
    expect(localeRedirectPath({ ...launch, userLocale: "zh-Hans" })).toBe(
      "/zh-Hans/driver?source=pwa",
    );
  });

  it("without a session uses the cookie, then Accept-Language, then German", () => {
    expect(localeRedirectPath({ ...launch, cookie: "zh-Hant-HK", acceptLanguage: "de-AT" })).toBe(
      "/zh-Hant-HK/driver?source=pwa",
    );
    expect(localeRedirectPath({ ...launch, acceptLanguage: "zh-TW,zh;q=0.8" })).toBe(
      "/zh-Hant-TW/driver?source=pwa",
    );
    expect(localeRedirectPath({ ...launch })).toBe("/de/driver?source=pwa");
  });

  it("ignores an invalid user locale or cookie", () => {
    expect(localeRedirectPath({ ...launch, userLocale: "xx", cookie: "zh-Hans" })).toBe(
      "/zh-Hans/driver?source=pwa",
    );
    expect(localeRedirectPath({ ...launch, cookie: "klingon" })).toBe("/de/driver?source=pwa");
  });

  it("keeps deep paths and the root", () => {
    expect(localeRedirectPath({ pathname: "/", search: "", cookie: "zh-Hans" })).toBe("/zh-Hans");
    expect(localeRedirectPath({ pathname: "/driver/stops/7", search: "", userLocale: "de" })).toBe(
      "/de/driver/stops/7",
    );
  });
});
