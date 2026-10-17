import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getDeferredPrompt,
  INSTALL_HINT_DISMISSED_KEY,
  markInstalled,
  readDismissed,
  resetInstallStateForTests,
  setDeferredPrompt,
  subscribeInstallState,
  writeDismissed,
} from "./install-prompt";

beforeEach(() => {
  window.localStorage.clear();
  resetInstallStateForTests();
});
afterEach(() => vi.restoreAllMocks());

describe("install prompt state", () => {
  it("remembers a dismissal in localStorage", () => {
    expect(readDismissed()).toBe(false);
    writeDismissed();
    expect(window.localStorage.getItem(INSTALL_HINT_DISMISSED_KEY)).toBe("1");
    resetInstallStateForTests();
    expect(readDismissed()).toBe(true); // survives a "reload" (state only in storage)
  });

  it("still works when localStorage throws (read and write)", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readDismissed()).toBe(false);
    expect(() => writeDismissed()).not.toThrow();
    expect(readDismissed()).toBe(true); // in-memory for this page session
  });

  it("notifies subscribers and clears the deferred event once installed", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeInstallState(listener);
    const event = Object.assign(new Event("beforeinstallprompt"), {
      prompt: vi.fn(),
      userChoice: Promise.resolve({ outcome: "accepted" as const }),
    });
    setDeferredPrompt(event);
    expect(getDeferredPrompt()).toBe(event);
    markInstalled();
    expect(getDeferredPrompt()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    writeDismissed();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
