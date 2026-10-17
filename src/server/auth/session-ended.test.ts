import { describe, expect, it } from "vitest";

import { sessionEndedTarget } from "./session-ended";

describe("sessionEndedTarget", () => {
  it("maps section and locale to the login page", () => {
    expect(sessionEndedTarget("zh-Hans", "driver")).toBe("/zh-Hans/driver/login");
    expect(sessionEndedTarget("de", "admin")).toBe("/de/login");
  });
  it("rejects unknown locales and sections (no open redirect)", () => {
    expect(sessionEndedTarget("//evil.com", "admin")).toBeNull();
    expect(sessionEndedTarget("de", "x")).toBeNull();
    expect(sessionEndedTarget(null, null)).toBeNull();
  });
});
