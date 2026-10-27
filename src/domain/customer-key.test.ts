import { describe, expect, it } from "vitest";

import { KEY_NUMBER_MAX, keyDisplay, normalizeKey, sameKey } from "./customer-key";

describe("normalizeKey", () => {
  it("keeps a trimmed number while a key exists", () => {
    expect(normalizeKey({ hasKey: true, keyNumber: "  A-17 " })).toEqual({
      hasKey: true,
      keyNumber: "A-17",
    });
  });

  it("stores blank text as no number", () => {
    expect(normalizeKey({ hasKey: true, keyNumber: "   " })).toEqual({
      hasKey: true,
      keyNumber: null,
    });
  });

  it("drops the number when there is no key or it is unknown", () => {
    expect(normalizeKey({ hasKey: false, keyNumber: "12" })).toEqual({
      hasKey: false,
      keyNumber: null,
    });
    expect(normalizeKey({ hasKey: null, keyNumber: "12" })).toEqual({
      hasKey: null,
      keyNumber: null,
    });
  });

  it("rejects a number longer than the limit", () => {
    expect(normalizeKey({ hasKey: true, keyNumber: "x".repeat(KEY_NUMBER_MAX) })).not.toBeNull();
    expect(normalizeKey({ hasKey: true, keyNumber: "x".repeat(KEY_NUMBER_MAX + 1) })).toBeNull();
  });
});

describe("sameKey / keyDisplay", () => {
  it("compares both fields", () => {
    expect(sameKey({ hasKey: true, keyNumber: "1" }, { hasKey: true, keyNumber: "1" })).toBe(true);
    expect(sameKey({ hasKey: true, keyNumber: "1" }, { hasKey: true, keyNumber: "2" })).toBe(false);
    expect(sameKey({ hasKey: null, keyNumber: null }, { hasKey: false, keyNumber: null })).toBe(
      false,
    );
  });

  it("maps the tri-state to what the driver sees", () => {
    expect(keyDisplay({ hasKey: null })).toEqual({ kind: "unknown" });
    expect(keyDisplay({})).toEqual({ kind: "unknown" });
    expect(keyDisplay({ hasKey: false })).toEqual({ kind: "none" });
    expect(keyDisplay({ hasKey: true, keyNumber: null })).toEqual({ kind: "present" });
    expect(keyDisplay({ hasKey: true, keyNumber: "42" })).toEqual({ kind: "number", number: "42" });
  });
});
