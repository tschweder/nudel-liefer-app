import { describe, expect, it, vi } from "vitest";

import { persistLocale } from "./locale";

function deps(userId: string | null) {
  return {
    getUserId: async () => userId,
    setCookie: vi.fn(),
    updateUserLocale: vi.fn(async () => {}),
  };
}

describe("persistLocale", () => {
  it("sets the cookie only when nobody is logged in", async () => {
    const d = deps(null);
    await persistLocale("zh-Hant-TW", d);
    expect(d.setCookie).toHaveBeenCalledWith("NEXT_LOCALE", "zh-Hant-TW");
    expect(d.updateUserLocale).not.toHaveBeenCalled();
  });

  it("also updates User.locale (DB enum name) when logged in", async () => {
    const d = deps("u1");
    await persistLocale("zh-Hant-HK", d);
    expect(d.updateUserLocale).toHaveBeenCalledWith("u1", "zh_Hant_HK");
  });

  it("syncs the session token locale for logged-in users only", async () => {
    const syncSession = vi.fn(async () => {});
    await persistLocale("zh-Hans", { ...deps("u1"), syncSession });
    expect(syncSession).toHaveBeenCalledWith("zh-Hans");
    const anon = vi.fn(async () => {});
    await persistLocale("zh-Hans", { ...deps(null), syncSession: anon });
    expect(anon).not.toHaveBeenCalled();
  });

  it("rejects unsupported locales without side effects", async () => {
    const d = deps("u1");
    await expect(persistLocale("fr", d)).rejects.toThrow();
    expect(d.setCookie).not.toHaveBeenCalled();
    expect(d.updateUserLocale).not.toHaveBeenCalled();
  });
});
