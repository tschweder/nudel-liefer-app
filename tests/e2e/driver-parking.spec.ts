import { expect, type Page, test as base } from "@playwright/test";

import {
  createDriverFixture,
  type DriverFixture,
  loginDriver,
  stubImages,
} from "./helpers/driver-fixture";
import { gotoSettled, installNetworkEmulation, setOnline } from "./helpers/network";

// NUD-144. Needs DATABASE_URL, S3_* and a PRODUCTION build (service worker for the offline test).
// The driver sets a Parkplatz at a stop: typed coordinates (comma or point), the device position,
// a refused position (message + typing), and offline (queued, applied on reconnect). The saved
// spot is the navigation point at once.
const test = base.extend<{ fx: DriverFixture }>({
  fx: async ({}, provide) => {
    const fx = await createDriverFixture("park");
    await provide(fx);
    await fx.cleanup();
  },
});

const customerOf = (fx: DriverFixture, i: number) => `cust-${i}-${fx.tag}`;
const spotsOf = async (fx: DriverFixture, i: number) =>
  (
    await fx.db.query(
      `SELECT "lat","lng","createdById","active" FROM "ParkingSpot" WHERE "customerId"=$1 ORDER BY "sortOrder","createdAt"`,
      [customerOf(fx, i)],
    )
  ).rows as Array<{ lat: number; lng: number; createdById: string; active: boolean }>;
const audits = async (fx: DriverFixture, i: number) =>
  (
    await fx.db.query(
      `SELECT "actorId","diff" FROM "AuditLog" WHERE "entity"='Customer' AND "entityId"=$1 AND "action"='parking.create' ORDER BY "createdAt","id"`,
      [customerOf(fx, i)],
    )
  ).rows as Array<{ actorId: string; diff: { via: string; isDefault: boolean } }>;

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

const setButton = (page: Page) => page.locator('[data-testid="parking-set"]:visible').first();
const navHref = (page: Page) =>
  page.locator('[data-testid="navigate"]:visible').first().getAttribute("href");

test.describe("driver", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test("types coordinates with a comma and navigates to the new Parkplatz", async ({
    page,
    fx,
  }) => {
    test.setTimeout(120_000);
    await fx.reset();
    await loginDriver(page, fx);
    await page.goto(`/de/driver/stops/${fx.stopIds[0]}`);
    await expect(page.getByTestId("parking-empty")).toBeVisible();
    expect(await navHref(page)).not.toContain("waypoints");

    const button = setButton(page);
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    await button.click();
    await expect(page.getByTestId("parking-confirm")).toBeDisabled();
    const manual = page.getByTestId("parking-mode-manual");
    expect((await manual.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    await manual.click();

    // Out of range: message, no map, no save.
    await page.getByTestId("parking-lat").fill("95");
    await page.getByTestId("parking-lng").fill("16,3738");
    await expect(page.getByTestId("parking-range-error")).toBeVisible();
    await expect(page.getByTestId("parking-confirm")).toBeDisabled();
    await expect(page.getByTestId("parking-map")).toHaveCount(0);

    await page.getByTestId("parking-lat").fill("48,2082");
    await expect(page.getByTestId("parking-range-error")).toHaveCount(0);
    await expect(page.getByTestId("parking-map")).toBeVisible();
    expect((await page.getByTestId("parking-lat").boundingBox())!.height).toBeGreaterThanOrEqual(
      48,
    );
    expect(await noHorizontalScroll(page)).toBe(true);
    await page.getByTestId("parking-confirm").click();
    await expect(page.getByTestId("parking-sheet")).toBeHidden();

    // Shown and used at once; saved with the driver as author and an audit entry.
    await expect(page.getByTestId("parking-spot")).toHaveCount(1);
    await expect.poll(() => navHref(page)).toContain("waypoints=48.2082,16.3738");
    await expect.poll(async () => (await spotsOf(fx, 0)).length).toBe(1);
    expect((await spotsOf(fx, 0))[0]).toMatchObject({
      lat: 48.2082,
      lng: 16.3738,
      createdById: fx.userId,
      active: true,
    });
    await expect.poll(async () => (await audits(fx, 0)).length).toBe(1);
    expect((await audits(fx, 0))[0]!.diff).toMatchObject({ via: "sync", isDefault: true });

    // After a reload the server data carries it, too.
    await page.reload();
    await expect(page.getByTestId("parking-spot")).toHaveCount(1);
    expect(await navHref(page)).toContain("waypoints=48.2082,16.3738");
  });

  test("uses the device position, and a refused position falls back to typing", async ({
    browser,
    fx,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    await fx.reset();
    const granted = await browser.newContext({
      baseURL,
      viewport: { width: 375, height: 667 },
      permissions: ["geolocation"],
      geolocation: { latitude: 48.21, longitude: 16.38 },
    });
    const page = await granted.newPage();
    await loginDriver(page, fx);
    await page.goto(`/de/driver/stops/${fx.stopIds[0]}`);
    await setButton(page).click();
    await page.getByTestId("parking-mode-gps").click();
    await expect(page.getByTestId("parking-map")).toBeVisible();
    await page.getByTestId("parking-confirm").click();
    await expect(page.getByTestId("parking-sheet")).toBeHidden();
    await expect.poll(async () => (await spotsOf(fx, 0)).length).toBe(1);
    expect((await spotsOf(fx, 0))[0]).toMatchObject({ lat: 48.21, lng: 16.38 });
    await granted.close();

    const denied = await browser.newContext({
      baseURL,
      viewport: { width: 375, height: 667 },
      permissions: [],
    });
    const deniedPage = await denied.newPage();
    await loginDriver(deniedPage, fx);
    await deniedPage.goto(`/de/driver/stops/${fx.stopIds[1]}`);
    await setButton(deniedPage).click();
    await deniedPage.getByTestId("parking-mode-gps").click();
    await expect(deniedPage.getByTestId("parking-gps-problem")).toContainText(
      "Der Standort ist nicht erlaubt",
    );
    await expect(deniedPage.getByTestId("parking-lat")).toBeVisible();
    await deniedPage.getByTestId("parking-lat").fill("48.3");
    await deniedPage.getByTestId("parking-lng").fill("16.4");
    await deniedPage.getByTestId("parking-confirm").click();
    await expect.poll(async () => (await spotsOf(fx, 1)).length).toBe(1);
    expect((await spotsOf(fx, 1))[0]).toMatchObject({ lat: 48.3, lng: 16.4 });
    await denied.close();
  });

  test("works offline: queued, navigation uses it at once, applied on reconnect", async ({
    page,
    context,
    fx,
  }) => {
    test.setTimeout(180_000);
    await fx.reset();
    await installNetworkEmulation(context);
    await stubImages(page);
    await loginDriver(page, fx);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, undefined, {
      timeout: 30_000,
    });
    await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });

    await setOnline(context, page, false);
    await gotoSettled(page, `/de/driver/stops/${fx.stopIds[1]}`);
    await setButton(page).click();
    await page.getByTestId("parking-mode-manual").click();
    await page.getByTestId("parking-lat").fill("48,25");
    await page.getByTestId("parking-lng").fill("16,35");
    await page.getByTestId("parking-confirm").click();
    await expect(page.getByTestId("parking-sheet")).toBeHidden();
    await expect.poll(() => navHref(page)).toContain("waypoints=48.25,16.35");
    expect(await spotsOf(fx, 1)).toHaveLength(0);

    await setOnline(context, page, true);
    await expect.poll(async () => (await spotsOf(fx, 1)).length, { timeout: 30_000 }).toBe(1);
    expect((await spotsOf(fx, 1))[0]).toMatchObject({ lat: 48.25, lng: 16.35 });
    expect((await audits(fx, 1)).map((a) => a.diff.via)).toEqual(["sync"]);
    await expect.poll(() => navHref(page)).toContain("waypoints=48.25,16.35");
  });
});
