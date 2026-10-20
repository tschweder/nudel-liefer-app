import { describe, expect, it } from "vitest";

import {
  loginKeys,
  MAX_FAILURES_PER_IP,
  MAX_FAILURES_PER_IP_CEILING,
  MAX_FAILURES_PER_USER,
  maxFailuresPerIp,
  MIN_FAILURES_PER_IP,
} from "./rate-limit";

describe("maxFailuresPerIp", () => {
  it("falls back to the default when unset, empty or not a number", () => {
    for (const raw of [undefined, "", "   ", "twenty", "20x", "-5", "1.5"]) {
      expect(maxFailuresPerIp(raw)).toBe(MAX_FAILURES_PER_IP);
    }
  });

  it("accepts a value inside the allowed range", () => {
    expect(maxFailuresPerIp("1")).toBe(MIN_FAILURES_PER_IP);
    expect(maxFailuresPerIp("20")).toBe(20);
    expect(maxFailuresPerIp("1000000")).toBe(MAX_FAILURES_PER_IP_CEILING);
    expect(maxFailuresPerIp(" 50 ")).toBe(50);
  });

  it("refuses values outside the range instead of clamping them", () => {
    expect(maxFailuresPerIp("0")).toBe(MAX_FAILURES_PER_IP);
    expect(maxFailuresPerIp(String(MAX_FAILURES_PER_IP_CEILING + 1))).toBe(MAX_FAILURES_PER_IP);
  });

  it("reads LOGIN_MAX_FAILURES_PER_IP from the environment by default", () => {
    const previous = process.env.LOGIN_MAX_FAILURES_PER_IP;
    try {
      process.env.LOGIN_MAX_FAILURES_PER_IP = "1234";
      expect(maxFailuresPerIp()).toBe(1234);
      delete process.env.LOGIN_MAX_FAILURES_PER_IP;
      expect(maxFailuresPerIp()).toBe(MAX_FAILURES_PER_IP);
    } finally {
      if (previous === undefined) delete process.env.LOGIN_MAX_FAILURES_PER_IP;
      else process.env.LOGIN_MAX_FAILURES_PER_IP = previous;
    }
  });
});

describe("loginKeys", () => {
  it("always limits the identifier, normalised and capped in length", () => {
    const keys = loginKeys("driver", `  ${"A".repeat(150)}  `, null);
    expect(keys).toHaveLength(1);
    expect(keys[0]!.limit).toBe(MAX_FAILURES_PER_USER);
    expect(keys[0]!.key).toBe(`user:driver:${"a".repeat(100)}`);
  });

  it("adds the IP key only when an address is known", () => {
    expect(loginKeys("admin", "boss@example.com", null).map((k) => k.key)).toEqual([
      "user:admin:boss@example.com",
    ]);
    expect(loginKeys("admin", "boss@example.com", "::1").map((k) => k.key)).toEqual([
      "user:admin:boss@example.com",
      "ip:::1",
    ]);
  });

  it("uses the IP limit it is given, so the e2e suite can raise it without touching the user limit", () => {
    const keys = loginKeys("driver", "driver-hk", "::1", MAX_FAILURES_PER_IP_CEILING);
    expect(keys.find((k) => k.key.startsWith("ip:"))?.limit).toBe(MAX_FAILURES_PER_IP_CEILING);
    expect(keys.find((k) => k.key.startsWith("user:"))?.limit).toBe(MAX_FAILURES_PER_USER);
  });
});
