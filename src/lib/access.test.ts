import { describe, expect, it } from "vitest";

import { decideAccess, postLoginPath, splitLocalePath } from "./access";

describe("splitLocalePath", () => {
  it("splits locale and rest", () => {
    expect(splitLocalePath("/zh-Hans/admin/x")).toEqual({ locale: "zh-Hans", rest: "/admin/x" });
    expect(splitLocalePath("/de")).toEqual({ locale: "de", rest: "" });
    expect(splitLocalePath("/admin")).toEqual({ locale: null, rest: "/admin" });
  });
});

describe("decideAccess", () => {
  it("sends anonymous visitors to the matching login page with a callback", () => {
    expect(decideAccess("/admin", null)).toEqual({
      type: "redirect",
      to: "/login",
      withCallback: true,
    });
    expect(decideAccess("/admin/customers", null)).toMatchObject({ to: "/login" });
    expect(decideAccess("/driver", null)).toEqual({
      type: "redirect",
      to: "/driver/login",
      withCallback: true,
    });
  });

  it("keeps drivers out of every admin route", () => {
    for (const path of ["/admin", "/admin/", "/admin/drivers", "/admin/a/b"]) {
      expect(decideAccess(path, "DRIVER")).toEqual({
        type: "redirect",
        to: "/driver",
        withCallback: false,
      });
    }
  });

  it("lets admins into both areas and drivers into the driver area", () => {
    expect(decideAccess("/admin/x", "ADMIN")).toEqual({ type: "allow" });
    expect(decideAccess("/driver/stops", "ADMIN")).toEqual({ type: "allow" });
    expect(decideAccess("/driver/stops", "DRIVER")).toEqual({ type: "allow" });
  });

  it("does not confuse look-alike prefixes", () => {
    expect(decideAccess("/administrator", null)).toEqual({ type: "allow" });
    expect(decideAccess("/drivers", null)).toEqual({ type: "allow" });
  });

  it("login pages stay reachable, also for a signed-in user (NUD-185)", () => {
    expect(decideAccess("/login", null)).toEqual({ type: "allow" });
    expect(decideAccess("/driver/login", null)).toEqual({ type: "allow" });
    // A shared tablet must be able to hand the device over: the page says who is signed in and
    // offers "Abmelden" instead of silently bouncing to that role's home screen.
    expect(decideAccess("/login", "ADMIN")).toEqual({ type: "allow" });
    expect(decideAccess("/driver/login", "DRIVER")).toEqual({ type: "allow" });
    expect(decideAccess("/login", "DRIVER")).toEqual({ type: "allow" });
    expect(decideAccess("/driver/login", "ADMIN")).toEqual({ type: "allow" });
  });
});

describe("postLoginPath", () => {
  it("goes to the role's home under the user's locale", () => {
    expect(postLoginPath({ role: "ADMIN", locale: "zh-Hans" })).toBe("/zh-Hans/admin");
    expect(postLoginPath({ role: "DRIVER", locale: "cs" })).toBe("/cs/driver");
  });

  it("returns to the requested page, re-prefixed with the user's locale", () => {
    expect(
      postLoginPath({ role: "ADMIN", locale: "zh-Hans", callbackUrl: "/de/admin/orders?d=1" }),
    ).toBe("/zh-Hans/admin/orders?d=1");
  });

  it("ignores external, protocol-relative, login and forbidden callbacks", () => {
    for (const cb of [
      "https://evil.example/de/admin",
      "//evil.example/de/admin",
      "/\\evil.example",
      "/de/admin",
      "/de/login",
      "/admin/x",
    ]) {
      expect(postLoginPath({ role: "DRIVER", locale: "de", callbackUrl: cb })).toBe("/de/driver");
    }
    expect(postLoginPath({ role: "ADMIN", locale: "de", callbackUrl: "/de/admin" })).toBe(
      "/de/admin",
    );
  });

  it("never produces anything but a same-site absolute path (open redirect fuzz)", () => {
    const nasty = [
      "javascript:alert(1)",
      "data:text/html,<script>1</script>",
      "/\\/evil.example",
      "/\t/evil.example",
      "/de/admin\r\nSet-Cookie: a=b",
      "/de/admin/\u0000",
      "///evil.example",
      "/de/admin//evil.example",
      "/de/admin@evil.example",
      "/de/admin/..%2F..%2Fevil",
      " //evil.example",
      "http:evil.example",
      "/%2F%2Fevil.example",
      "/de/admin#//evil.example",
      "/de/admin?next=https://evil.example",
    ];
    for (const callbackUrl of nasty) {
      for (const role of ["ADMIN", "DRIVER"] as const) {
        const result = postLoginPath({ role, locale: "de", callbackUrl });
        expect(result, callbackUrl).toMatch(/^\/de\/[^/\\]/);
        expect(result, callbackUrl).not.toMatch(/[\\\u0000-\u001f]/);
        expect(result.startsWith("//"), callbackUrl).toBe(false);
      }
    }
  });
});
