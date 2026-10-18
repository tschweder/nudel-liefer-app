import { expect, type Page, test } from "@playwright/test";

import { createDriverFixture, type DriverFixture, loginDriver } from "./helpers/driver-fixture";

// NUD-095 performance budget: the driver home (today's tour, 25 stops) paints its largest content
// in < 2.5 s on "Slow 4G" with a 4x slower CPU after the first load (warm cache / service worker).
// Needs DATABASE_URL, S3_* and a PRODUCTION build (`next start`): a dev server is far slower and
// would measure nothing useful. This is Chromium's DevTools throttling on a desktop machine, NOT a
// real low-end Android phone; the CI runner decides the real margin.
//
// Lighthouse CI is not used here (see backlog NUD-095 notes); this is the same metric, measured
// with a PerformanceObserver.
test.use({ viewport: { width: 360, height: 640 } });

const BUDGET_MS = 2500;
// Chrome DevTools preset "Slow 4G": 1.6 Mbit/s down, 750 kbit/s up, 150 ms latency (x0.9 factor).
const SLOW_4G = {
  offline: false,
  latency: 150,
  downloadThroughput: Math.round(((1.6 * 1024 * 1024) / 8) * 0.9),
  uploadThroughput: Math.round(((750 * 1024) / 8) * 0.9),
};

let fx: DriverFixture;
test.beforeAll(async () => {
  fx = await createDriverFixture("perf", 25);
});
test.afterAll(async () => {
  await fx.cleanup();
});

async function throttle(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", SLOW_4G);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  return cdp;
}

async function measureLcp(page: Page, url: string) {
  await page.addInitScript(() => {
    const w = window as unknown as { __lcp: { time: number; el: string }[] };
    w.__lcp = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        const entry = e as PerformanceEntry & {
          element?: Element;
          renderTime: number;
          loadTime: number;
        };
        w.__lcp.push({
          time: entry.renderTime || entry.loadTime || entry.startTime,
          el: entry.element
            ? `${entry.element.tagName.toLowerCase()}${entry.element.getAttribute("data-testid") ? `[${entry.element.getAttribute("data-testid")}]` : ""}`
            : "?",
        });
      }
    }).observe({ type: "largest-contentful-paint", buffered: true });
  });
  await page.goto(url, { waitUntil: "load" });
  await expect(page.getByTestId("today-tour")).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  const entries = await page.evaluate(
    () => (window as unknown as { __lcp: { time: number; el: string }[] }).__lcp,
  );
  expect(entries.length, "the browser reported an LCP").toBeGreaterThan(0);
  return entries[entries.length - 1];
}

test("driver home LCP < 2.5 s on Slow 4G + 4x CPU after the first load", async ({ page }, info) => {
  test.setTimeout(150_000);
  await fx.reset();
  await loginDriver(page, fx);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.goto("/de/driver");
  await expect(page.getByTestId("today-tour")).toBeVisible();
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(3000); // offline sync of the tour and photos

  await throttle(page);
  // Warm: assets are in the HTTP cache / service worker precache from the visit above.
  const warm: { time: number; el: string }[] = [];
  for (let run = 0; run < 3; run++) {
    const sample = await measureLcp(page, "/de/driver");
    warm.push(sample);
    // Each navigation must register its own observer: reload via a fresh page state.
    await page.evaluate(() => undefined);
  }
  const times = warm.map((w) => Math.round(w.time));
  console.log(`LCP warm (ms): ${times.join(", ")} element: ${warm.map((w) => w.el).join(", ")}`);
  info.annotations.push({ type: "lcp-warm-ms", description: times.join(",") });
  const median = [...times].sort((a, b) => a - b)[1];
  expect(median, `median LCP ${median} ms`).toBeLessThan(BUDGET_MS);
});

test("cold first visit LCP (information, generous bound)", async ({ browser }, info) => {
  test.setTimeout(150_000);
  await fx.reset();
  // Log in unthrottled, then open the app in a fresh context that only shares the session cookie:
  // empty HTTP cache, no service worker.
  const first = await browser.newContext({ viewport: { width: 360, height: 640 } });
  const loginPage = await first.newPage();
  await loginDriver(loginPage, fx);
  const state = await first.storageState();
  await first.close();
  const context = await browser.newContext({
    viewport: { width: 360, height: 640 },
    storageState: state,
  });
  const page = await context.newPage();
  const cdp = await throttle(page);
  const sizes = new Map<string, number>();
  const urls = new Map<string, string>();
  cdp.on("Network.responseReceived", (e) => urls.set(e.requestId, e.response.url));
  cdp.on("Network.loadingFinished", (e) => sizes.set(e.requestId, e.encodedDataLength));
  const cold = await measureLcp(page, "/de/driver");
  const rows = [...sizes].map(([id, bytes]) => [bytes, urls.get(id) ?? "?"] as const);
  rows.sort((a, b) => b[0] - a[0]);
  const total = rows.reduce((sum, [bytes]) => sum + bytes, 0);
  console.log(
    `COLD transfer ${Math.round(total / 1024)} KiB in ${rows.length} requests; biggest: ` +
      rows
        .slice(0, 8)
        .map(([b, u]) => `${Math.round(b / 1024)}KiB ${u.split("/").slice(-1)[0].slice(0, 40)}`)
        .join(" | "),
  );
  console.log(`LCP cold (ms): ${Math.round(cold.time)} element: ${cold.el}`);
  info.annotations.push({ type: "lcp-cold-ms", description: String(Math.round(cold.time)) });
  expect(cold.time).toBeLessThan(8000);
  await context.close();
});
