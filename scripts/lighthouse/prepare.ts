/**
 * Prepares the Lighthouse CI run on the driver home (NUD-095).
 *
 * The driver home needs a logged-in driver with a released tour for today. This script
 *   1. inserts a driver ("lighthouse") with a released 25-stop tour for today into DATABASE_URL,
 *   2. opens the app once in a persistent Chromium profile (LHCI_PROFILE_DIR): logs in, lets the
 *      service worker take control and the offline copy sync - the "after the first load" state,
 *   3. closes the browser so that cookie, HTTP cache and service worker are on disk.
 * `lhci autorun` (lighthouserc.cjs) then starts Chrome with the same profile and keeps its storage.
 *
 * Usage: DATABASE_URL=... BASE_URL=http://localhost:3000 LHCI_PROFILE_DIR=.lighthouseci/profile \
 *        [CHROME_PATH=/path/to/chrome] tsx scripts/lighthouse/prepare.ts
 */
import fs from "node:fs";
import path from "node:path";

import { chromium } from "@playwright/test";

import { createDriverFixture, PIN } from "../../tests/e2e/helpers/driver-fixture";

const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
const profileDir = path.resolve(process.env.LHCI_PROFILE_DIR ?? ".lighthouseci/profile");
const chromePath = process.env.CHROME_PATH || process.env.LHCI_CHROME_PATH || undefined;

async function main() {
  fs.rmSync(profileDir, { recursive: true, force: true });
  fs.mkdirSync(profileDir, { recursive: true });
  const fx = await createDriverFixture("lh", 25);
  await fx.reset();
  const context = await chromium.launchPersistentContext(profileDir, {
    ...(chromePath ? { executablePath: chromePath } : {}),
    headless: true,
    args: ["--no-sandbox"],
    viewport: { width: 412, height: 823 },
  });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(`${baseUrl}/de/driver/login`);
    await page.locator('input[name="username"]').fill(fx.username);
    await page.locator('input[name="pin"]').fill(PIN);
    await page.getByTestId("login-submit").click();
    await page.waitForURL(/\/driver$/);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.goto(`${baseUrl}/de/driver`);
    await page.waitForFunction(() => navigator.serviceWorker?.controller !== null);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000); // offline sync of the tour
  } finally {
    await context.close();
  }
  // The tour stays in the database for the Lighthouse runs; remove it with scripts/lighthouse/cleanup
  // (a throw-away CI database does not need that).
  console.log(`Prepared profile ${profileDir} for driver ${fx.username}`);
  await fx.db.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
