import { describe, expect, it } from "vitest";

import {
  ADMIN_SESSION_SECONDS,
  applyJwt,
  DRIVER_SESSION_SECONDS,
  sessionMaxAge,
} from "./session-token";

describe("sessionMaxAge", () => {
  it("is 12 h for admins and 90 days for drivers", () => {
    expect(sessionMaxAge("ADMIN")).toBe(12 * 3600);
    expect(ADMIN_SESSION_SECONDS).toBe(43200);
    expect(sessionMaxAge("DRIVER")).toBe(90 * 24 * 3600);
    expect(DRIVER_SESSION_SECONDS).toBe(7776000);
    expect(sessionMaxAge(undefined)).toBe(DRIVER_SESSION_SECONDS);
  });
});

describe("applyJwt", () => {
  it("copies identity on sign-in", () => {
    const token = applyJwt({
      token: {},
      user: { id: "u1", role: "DRIVER", locale: "zh-Hans", name: "X" },
      trigger: "signIn",
    });
    expect(token).toMatchObject({ sub: "u1", role: "DRIVER", locale: "zh-Hans", name: "X" });
  });

  it("applies valid locale updates only", () => {
    const base = { sub: "u1", role: "ADMIN" as const, locale: "de" };
    expect(
      applyJwt({
        token: { ...base },
        trigger: "update",
        session: { user: { locale: "cs" } },
      }).locale,
    ).toBe("cs");
    expect(
      applyJwt({ token: { ...base }, trigger: "update", session: { user: { locale: "fr" } } })
        .locale,
    ).toBe("de");
  });

  it("never lets an update change the role", () => {
    const t = applyJwt({
      token: { sub: "u1", role: "DRIVER" },
      trigger: "update",
      session: { user: { role: "ADMIN" } },
    });
    expect(t.role).toBe("DRIVER");
  });
});
