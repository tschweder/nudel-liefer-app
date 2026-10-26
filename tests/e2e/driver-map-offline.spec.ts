import { expect, type Page, test } from "@playwright/test";
import bcrypt from "bcryptjs";
import { Client } from "pg";

import { axeAudit } from "./helpers/driver-audit";
import { installNetworkEmulation, setOnline } from "./helpers/network";

// NUD-108. Needs DATABASE_URL and a PRODUCTION build (`pnpm build && pnpm start`): the service
// worker (offline shell) only exists there. The tile server is stubbed. Phone viewport.
test.use({ viewport: { width: 375, height: 812 } });

const PIN = "482916";
const tag = `mapo${Date.now() % 1e8}${Math.floor(Math.random() * 1e4)}`;
const username = `drv-${tag}`;
const TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const NOTICE: Record<string, string> = {
  de: "Kartenhintergrund offline nicht verfügbar",
  "zh-Hans": "离线时无法显示地图背景",
};

let db: Client;
let userId: string;
let tourId: string;
const names = [1, 2, 3].map((n) => `Trattoria ${n} ${tag}`);
let tileRequests = 0;

test.beforeAll(async () => {
  db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  userId = `id-${tag}`;
  await db.query(
    `INSERT INTO "User" ("id","role","username","passwordHash","locale","localeChosen","displayName","updatedAt")
     VALUES ($1,'DRIVER',$2,$3,'de',true,'Map Driver',now())`,
    [userId, username, await bcrypt.hash(PIN, 10)],
  );
  const kg = `prod-kg-${tag}`;
  await db.query(
    `INSERT INTO "Product" ("id","sku","name","unit","updatedAt") VALUES ($1,$2,$3::jsonb,'KG',now())`,
    [
      kg,
      `KG-${tag}`,
      JSON.stringify({
        de: "Spaghetti lose",
        "zh-Hans": "意大利面",
        "zh-Hant-HK": "意大利麵",
        "zh-Hant-TW": "義大利麵",
        meta: { source: "de", machine: {}, updatedAt: "2099-01-01T00:00:00Z" },
      }),
    ],
  );
  const tz =
    ((await db.query(`SELECT "timezone" FROM "Settings"`)).rows[0] as { timezone?: string })
      ?.timezone ?? "Europe/Vienna";
  const today = (await db.query(`SELECT (now() AT TIME ZONE $1)::date AS d`, [tz])).rows[0]
    .d as Date;
  tourId = `tour-${tag}`;
  const coords = [
    [16.3738, 48.2082],
    [16.37, 48.2],
    [16.38, 48.21],
    [16.39, 48.22],
    [16.3738, 48.2082],
  ];
  await db.query(
    `INSERT INTO "Tour" ("id","date","driverId","status","depotSnapshot","geometry","releaseRevision","releasedAt","updatedAt")
     VALUES ($1,$2,$3,'RELEASED',$4::jsonb,$5::jsonb,1,now(),now())`,
    [
      tourId,
      today,
      userId,
      JSON.stringify({ name: "Depot", address: "Graben 1", lat: 48.2082, lng: 16.3738 }),
      JSON.stringify({ type: "LineString", coordinates: coords }),
    ],
  );
  for (let i = 0; i < 3; i++) {
    const customerId = `cust-${i}-${tag}`;
    await db.query(
      `INSERT INTO "Customer" ("id","customerNumber","name","street","postalCode","city","lat","lng","pinConfirmed","updatedAt")
       VALUES ($1,$2,$3,'Hauptstraße 1','1010','Wien',$4,$5,true,now())`,
      [
        customerId,
        `${tag}-${i}`,
        names[i],
        Number((48.2 + i / 100).toFixed(2)),
        Number((16.37 + i / 100).toFixed(2)),
      ],
    );
    await db.query(
      `INSERT INTO "Stop" ("id","tourId","customerId","sequence","status","etaAt","legDurationS","items")
       VALUES ($1,$2,$3,$4,'PENDING',$5,600,$6::jsonb)`,
      [
        `stop-${i}-${tag}`,
        tourId,
        customerId,
        i + 1,
        new Date(today.getTime() + (8 + i) * 3600_000),
        JSON.stringify([{ productId: kg, quantity: 1250 }]),
      ],
    );
  }
});

test.afterAll(async () => {
  await db.query(`DELETE FROM "Stop" WHERE "tourId"=$1`, [tourId]);
  await db.query(`DELETE FROM "Tour" WHERE "id"=$1`, [tourId]);
  await db.query(`DELETE FROM "Customer" WHERE "id" LIKE $1`, [`cust-%-${tag}`]);
  await db.query(`DELETE FROM "Product" WHERE "id" LIKE $1`, [`prod-%-${tag}`]);
  await db.query(`DELETE FROM "LoginAttempt" WHERE "key" LIKE $1`, [`%${tag}%`]).catch(() => {});
  await db.query(`DELETE FROM "User" WHERE "id"=$1`, [userId]);
  await db.end();
});

test.describe.configure({ mode: "serial" });
test.beforeEach(async ({ context }) => installNetworkEmulation(context));

async function loginReady(page: Page, locale: string) {
  tileRequests = 0;
  await page.route(/\/\d+\/\d+\/\d+\.png/, (route) => {
    tileRequests++;
    return route.fulfill({ status: 200, contentType: "image/png", body: TILE });
  });
  await page.goto("/de/driver/login");
  const form = page.getByTestId("driver-login-form");
  await form.locator('input[name="username"]').fill(username);
  await form.locator('input[name="pin"]').fill(PIN);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/de\/driver$/);
  if (locale !== "de") {
    await page.goto(`/${locale}/driver`);
    await expect(page).toHaveURL(new RegExp(`/${locale}/driver$`));
  }
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, undefined, {
    timeout: 30_000,
  });
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
}

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

async function expectDegradedMap(page: Page, locale: string) {
  const map = page.getByTestId("tour-map");
  await expect(map).toBeVisible();
  await expect(map).toHaveAttribute("data-tiles", "unavailable");
  const notice = page.getByTestId("map-tiles-notice");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText(NOTICE[locale]!);
  // Stops 1..3 and the depot are still markers, the route is still drawn, no tile grid at all.
  await expect(map.locator(".leaflet-marker-icon")).toHaveCount(4);
  await expect(map.locator(".leaflet-marker-icon").filter({ hasText: /^[123]$/ })).toHaveCount(3);
  await expect(map.locator("path.leaflet-interactive")).toHaveCount(1);
  await expect(map.locator("img.leaflet-tile")).toHaveCount(0);
  expect(await noHorizontalScroll(page)).toBe(true);
}

for (const locale of ["de", "zh-Hans"] as const) {
  test(`map view: tiles online, then offline keeps markers, route and a notice (${locale}, 375 px)`, async ({
    page,
    context,
  }, testInfo) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await loginReady(page, locale);

    // Online: tiles are requested and shown, no notice.
    await page.getByTestId("view-map").click();
    const map = page.getByTestId("tour-map");
    await expect(map).toHaveAttribute("data-tiles", "ok");
    await expect(map.locator("img.leaflet-tile").first()).toBeAttached();
    await expect(page.getByTestId("map-tiles-notice")).toHaveCount(0);
    expect(tileRequests).toBeGreaterThan(0);

    // Cut the network while the map is open.
    await setOnline(context, page, false);
    await expectDegradedMap(page, locale);
    const before = tileRequests;
    await page.getByTestId("view-list").click();
    await page.getByTestId("view-map").click();
    await expectDegradedMap(page, locale);
    expect(tileRequests).toBe(before); // no tile requests while offline

    const axe = await axeAudit(page, `map-offline-${locale}`, testInfo);
    expect(axe, "serious / critical axe findings").toEqual([]);
    await page.screenshot({ path: `/tmp/nud108-map-offline-${locale}.png`, fullPage: true });

    // Reload while offline: the offline shell shows the same degraded map.
    await page.reload();
    await expect(page.getByTestId("offline-bar")).toBeVisible();
    await page.getByTestId("view-map").click();
    await expectDegradedMap(page, locale);
    const axeShell = await axeAudit(page, `map-offline-shell-${locale}`, testInfo);
    expect(axeShell, "serious / critical axe findings").toEqual([]);

    // Back online: tiles return.
    await setOnline(context, page, true);
    // The shell refreshes itself into the live page, which starts on the list again.
    await expect(async () => {
      if (!(await page.getByTestId("tour-map").isVisible())) {
        await page.getByTestId("view-map").click({ timeout: 2000 });
      }
      await expect(page.getByTestId("tour-map")).toHaveAttribute("data-tiles", "ok", {
        timeout: 2000,
      });
    }).toPass({ timeout: 30_000 });
    await expect(page.getByTestId("map-tiles-notice")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
