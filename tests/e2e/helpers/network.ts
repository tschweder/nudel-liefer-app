import type { BrowserContext, Page } from "@playwright/test";

/**
 * `navigator.onLine` and the online / offline events do not follow `context.setOffline()` in every
 * Chromium build (headless Linux without a network manager reports `false` permanently). The app
 * relies on them for its offline bar, so the tests drive them explicitly: the flag lives in
 * localStorage so that it survives navigations (also those answered by the service worker).
 */
export async function installNetworkEmulation(context: BrowserContext) {
  await context.addInitScript(() => {
    const isOnline = () => {
      try {
        return localStorage.getItem("e2e-offline") !== "1";
      } catch {
        return true;
      }
    };
    Object.defineProperty(Navigator.prototype, "onLine", { configurable: true, get: isOnline });
  });
}

/** Cuts / restores the network for all requests (pages and service worker) and tells the page. */
export async function setOnline(context: BrowserContext, page: Page, online: boolean) {
  await context.setOffline(!online);
  await page.evaluate((on) => {
    localStorage.setItem("e2e-offline", on ? "0" : "1");
    window.dispatchEvent(new Event(on ? "online" : "offline"));
  }, online);
}
