import { describe, expect, it, vi } from "vitest";

import { DEFAULT_THEME, otherTheme, resolveTheme } from "@/lib/theme";

import { persistTheme } from "./theme";

function deps() {
  return { setCookie: vi.fn() };
}

describe("resolveTheme", () => {
  it("defaults to light — the brighter design is what was asked for", () => {
    expect(DEFAULT_THEME).toBe("light");
    expect(resolveTheme(undefined)).toBe("light");
    expect(resolveTheme(null)).toBe("light");
    expect(resolveTheme("")).toBe("light");
  });

  it("accepts both known values and rejects anything else", () => {
    expect(resolveTheme("dark")).toBe("dark");
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme("system")).toBe("light");
    expect(resolveTheme("DARK")).toBe("light");
  });

  it("switches between the two schemes", () => {
    expect(otherTheme("light")).toBe("dark");
    expect(otherTheme("dark")).toBe("light");
  });
});

describe("persistTheme", () => {
  it("writes the validated theme to the cookie", async () => {
    const d = deps();
    expect(await persistTheme("dark", d)).toBe("dark");
    expect(d.setCookie).toHaveBeenCalledWith("NEXT_THEME", "dark");
  });

  it("rejects an unknown theme without touching the cookie", async () => {
    const d = deps();
    await expect(persistTheme("system", d)).rejects.toThrow();
    expect(d.setCookie).not.toHaveBeenCalled();
  });
});
