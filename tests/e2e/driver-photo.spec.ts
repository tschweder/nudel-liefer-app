import { expect, type Page, test } from "@playwright/test";
import bcrypt from "bcryptjs";
import { Client } from "pg";

import { installNetworkEmulation, setOnline } from "./helpers/network";
import { png } from "./helpers/png";

// NUD-083. Needs DATABASE_URL, SEED_ADMIN_PASSWORD (the office checks the customer profile), a
// PRODUCTION build (`pnpm build && pnpm start`, the service worker only exists there) and an
// S3-compatible store (MinIO / s3rver) for the app: the browser really PUTs the photo to the
// presigned URL. Own driver, customers and a released tour for TODAY in the factory time zone.
// The "camera" is `setInputFiles` on the file input (`capture="environment"`). Phone viewport.
test.use({ viewport: { width: 375, height: 812 } });

const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "change-me-local-only";
const PIN = "482916";
const tag = `phot${Date.now() % 1e8}${Math.floor(Math.random() * 1e4)}`;
const username = `drv-${tag}`;
const DRIVER_NAME = `Fahrer Ali ${tag}`;
const TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const COUNT = 3;

let db: Client;
let userId: string;
let tourId: string;
const stopIds: string[] = [];
const customerIds: string[] = [];
const names = Array.from({ length: COUNT }, (_, i) => `Trattoria ${i + 1} ${tag}`);

test.beforeAll(async () => {
  db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const hash = await bcrypt.hash(PIN, 10);
  userId = `id-${tag}`;
  await db.query(
    `INSERT INTO "User" ("id","role","username","passwordHash","locale","localeChosen","displayName","updatedAt")
     VALUES ($1,'DRIVER',$2,$3,'de',true,$4,now())`,
    [userId, username, hash, DRIVER_NAME],
  );
  const kg = `prod-kg-${tag}`;
  await db.query(
    `INSERT INTO "Product" ("id","sku","name","unit","weightKgPerUnit","updatedAt") VALUES ($1,$2,$3::jsonb,'KG',1,now())`,
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
  const settings = (await db.query(`SELECT "timezone" FROM "Settings"`)).rows[0] as {
    timezone: string;
  };
  const tz = settings?.timezone ?? "Europe/Vienna";
  const today = (await db.query(`SELECT (now() AT TIME ZONE $1)::date AS d`, [tz])).rows[0]
    .d as Date;
  tourId = `tour-${tag}`;
  await db.query(
    `INSERT INTO "Tour" ("id","date","driverId","status","depotSnapshot","releaseRevision","releasedAt","updatedAt")
     VALUES ($1,$2,$3,'RELEASED',$4::jsonb,1,now(),now())`,
    [
      tourId,
      today,
      userId,
      JSON.stringify({ name: "Depot", address: "Graben 1", lat: 48.2082, lng: 16.3738 }),
    ],
  );
  for (let i = 0; i < COUNT; i++) {
    const customerId = `cust-${i}-${tag}`;
    customerIds.push(customerId);
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
    const stopId = `stop-${i}-${tag}`;
    stopIds.push(stopId);
    await db.query(
      `INSERT INTO "Stop" ("id","tourId","customerId","sequence","status","etaAt","legDurationS","items")
       VALUES ($1,$2,$3,$4,'PENDING',$5,600,$6::jsonb)`,
      [
        stopId,
        tourId,
        customerId,
        i + 1,
        new Date(today.getTime() + (8 + i) * 3600_000),
        JSON.stringify([{ productId: kg, quantity: 500 + i * 100 }]),
      ],
    );
  }
});

test.afterAll(async () => {
  await db.query(`DELETE FROM "Photo" WHERE "customerId" = ANY($1)`, [customerIds]);
  await db.query(`DELETE FROM "StopMutation" WHERE "stopId" = ANY($1)`, [stopIds]);
  await db.query(`DELETE FROM "Stop" WHERE "tourId"=$1`, [tourId]);
  await db.query(`DELETE FROM "Tour" WHERE "id"=$1`, [tourId]);
  await db.query(`DELETE FROM "Customer" WHERE "id" LIKE $1`, [`cust-%-${tag}`]);
  await db.query(`DELETE FROM "Product" WHERE "id" LIKE $1`, [`prod-%-${tag}`]);
  await db.query(`DELETE FROM "LoginAttempt" WHERE "key" LIKE $1`, [`%${tag}%`]).catch(() => {});
  await db.query(`DELETE FROM "User" WHERE "id" = $1`, [userId]);
  await db.end();
});

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ context }) => {
  await installNetworkEmulation(context);
  await db.query(`DELETE FROM "Photo" WHERE "customerId" = ANY($1)`, [customerIds]);
  await db.query(`UPDATE "Stop" SET "status"='PENDING', "completedAt"=NULL WHERE "tourId"=$1`, [
    tourId,
  ]);
});

const photoRows = async (customerIndex?: number) =>
  (
    await db.query(
      `SELECT "id","customerId","kind","storageKey","isCurrent","uploadedById","clientMutationId","bytes","width","height"
       FROM "Photo" WHERE "customerId" = ANY($1) ${customerIndex === undefined ? "" : `AND "customerId" = '${customerIds[customerIndex]}'`}
       ORDER BY "createdAt"`,
      [customerIds],
    )
  ).rows as Array<{
    id: string;
    customerId: string;
    kind: string;
    storageKey: string;
    isCurrent: boolean;
    uploadedById: string;
    clientMutationId: string | null;
    bytes: number;
    width: number;
    height: number;
  }>;

async function login(page: Page) {
  await page.route(/\/\d+\/\d+\/\d+\.png/, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: TILE }),
  );
  await page.goto("/de/driver/login");
  const form = page.getByTestId("driver-login-form");
  await form.locator('input[name="username"]').fill(username);
  await form.locator('input[name="pin"]').fill(PIN);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/de\/driver$/);
}

/** Logged in, tour stored, the worker controls the page. */
async function readyOffline(page: Page) {
  await login(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, undefined, {
    timeout: 30_000,
  });
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
}

const visible = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`);
const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

/** Retries while a navigation destroys the page's execution context. */
async function eventually<T>(read: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await read();
    } catch (error) {
      if (attempt >= 20) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

type QueuedPhoto = {
  clientMutationId: string;
  kind: string;
  stopId: string;
  customerId: string;
  size: number;
  type: string;
  storageKey: string | null;
};

const queuedPhotos = (page: Page) =>
  eventually(() =>
    page.evaluate(
      () =>
        new Promise<QueuedPhoto[]>((resolve, reject) => {
          const open = indexedDB.open("nudel-driver-offline");
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const database = open.result;
            if (!database.objectStoreNames.contains("photos")) {
              database.close();
              resolve([]);
              return;
            }
            const all = database.transaction("photos").objectStore("photos").getAll();
            all.onsuccess = () => {
              database.close();
              resolve(
                all.result.map((row) => ({
                  clientMutationId: row.clientMutationId,
                  kind: row.kind,
                  stopId: row.stopId,
                  customerId: row.customerId,
                  size: (row.blob as Blob).size,
                  type: (row.blob as Blob).type,
                  storageKey: row.storageKey ?? null,
                })),
              );
            };
            all.onerror = () => reject(all.error);
          };
        }),
    ),
  );

const shot = (width: number, height: number, color: [number, number, number]) => ({
  name: "shot.png",
  mimeType: "image/png",
  buffer: png(width, height, color),
});

test("the missing-photo placeholder offers Take photo directly; shot -> preview -> use photo (online)", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await readyOffline(page);
  await page.goto(`/de/driver/stops/${stopIds[0]}`);

  const slot = visible(page, "photo-store");
  const placeholder = slot.getByTestId("photo-missing");
  await expect(placeholder).toBeVisible();
  const take = placeholder.getByTestId("photo-take-store");
  await expect(take).toBeVisible();
  await expect(take).toHaveText(/Foto aufnehmen/);
  // 48 px touch target, camera input as specified
  expect((await take.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  const input = slot.getByTestId("photo-input-store");
  await expect(input).toHaveAttribute("capture", "environment");
  await expect(input).toHaveAttribute("accept", "image/*");
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("photo-placeholder.png"), fullPage: true });

  // "Take" the picture: a large landscape shot is resized to <= 1600 px before anything is saved.
  await input.setInputFiles(shot(2400, 1800, [200, 120, 60]));
  const preview = slot.getByTestId("photo-preview");
  await expect(preview).toBeVisible();
  await expect(slot.getByTestId("photo-confirm")).toBeVisible();
  await expect(slot.getByTestId("photo-retake")).toBeVisible();
  expect(await queuedPhotos(page)).toHaveLength(0); // nothing is kept before the driver confirms
  expect(await photoRows()).toHaveLength(0);
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("photo-preview.png"), fullPage: true });

  await slot.getByTestId("photo-confirm").click();
  await expect.poll(async () => (await photoRows()).length, { timeout: 30_000 }).toBe(1);
  const [row] = await photoRows();
  expect(row).toMatchObject({
    customerId: customerIds[0],
    kind: "STORE",
    isCurrent: true,
    uploadedById: userId,
    width: 1600,
    height: 1200,
  });
  expect(row!.clientMutationId).toMatch(/^[0-9a-f-]{36}$/);
  expect(row!.storageKey).toMatch(/^customers\/[0-9a-f-]{36}\.jpg$/);
  expect(row!.bytes).toBeGreaterThan(0);
  await expect(page.getByTestId("pending-badge")).toHaveCount(0, { timeout: 30_000 });
  await expect.poll(async () => (await queuedPhotos(page)).length).toBe(0);

  // The slot shows the photo ("sent"), and after a reload the stored one; the other slot is open.
  await expect(slot.getByTestId("photo-missing")).toHaveCount(0);
  await expect(slot.getByTestId("photo-replace-store")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("photo-sent.png"), fullPage: true });
  await page.reload();
  await expect(visible(page, "photo-store").getByTestId("photo-missing")).toHaveCount(0);
  await expect(visible(page, "photo-store").locator("img").first()).toBeVisible();
  await expect(visible(page, "photo-parking").getByTestId("photo-take-parking")).toBeVisible();
  expect(
    await visible(page, "photo-store")
      .locator("img")
      .first()
      .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("photo taken offline is kept on the phone, shown at once and appears on the customer profile after reconnect", async ({
  page,
  context,
  browser,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await readyOffline(page);
  const registerRequests: string[] = [];
  const uploadRequests: string[] = [];
  // Requests the server actually answered (attempts that fail offline are not counted).
  page.on("response", (response) => {
    const request = response.request();
    if (request.method() !== "POST") return;
    if (request.url().endsWith("/api/driver/photos")) registerRequests.push(request.url());
    if (request.url().endsWith("/api/uploads")) uploadRequests.push(request.url());
  });

  await setOnline(context, page, false);
  await page.goto(`/de/driver/stops/${stopIds[1]}`).catch(() => {});
  await expect(page.getByTestId("offline-bar")).toBeVisible();
  const slot = visible(page, "photo-parking");
  await expect(slot.getByTestId("photo-take-parking")).toBeVisible();
  await slot.getByTestId("photo-input-parking").setInputFiles(shot(3000, 2000, [40, 160, 90]));
  await expect(slot.getByTestId("photo-preview")).toBeVisible();
  await slot.getByTestId("photo-confirm").click();

  // At once: the new photo is in the slot, from the local blob, marked "waiting"; the badge counts.
  await expect(slot.getByTestId("photo-pending")).toBeVisible();
  await expect(slot.getByTestId("photo-missing")).toHaveCount(0);
  await expect(page.getByTestId("pending-badge")).toHaveAttribute("data-count", "1");
  const shownSrc = await slot.locator("img").first().getAttribute("src");
  expect(shownSrc).toMatch(/^blob:/);
  expect(
    await slot
      .locator("img")
      .first()
      .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth === 1600),
  ).toBe(true);
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("photo-offline-pending.png"), fullPage: true });

  // The resized blob (not the 3000 px original) is stored in IndexedDB; the server knows nothing.
  const queued = await queuedPhotos(page);
  expect(queued).toHaveLength(1);
  expect(queued[0]).toMatchObject({
    kind: "PARKING",
    stopId: stopIds[1],
    customerId: customerIds[1],
    type: "image/jpeg",
    storageKey: null,
  });
  expect(queued[0]!.size).toBeGreaterThan(0);
  expect(await photoRows()).toHaveLength(0);
  expect(registerRequests).toHaveLength(0);

  // Still there after leaving the screen and coming back (offline), from the stored blob.
  await page.goto("/de/driver").catch(() => {});
  await expect(page.getByTestId("pending-badge")).toHaveAttribute("data-count", "1");
  await page.goto(`/de/driver/stops/${stopIds[1]}`).catch(() => {});
  await expect(visible(page, "photo-parking").getByTestId("photo-pending")).toBeVisible();

  // Reconnect: upload + registration, exactly one photo, queue empty.
  const clientMutationId = queued[0]!.clientMutationId;
  await setOnline(context, page, true);
  await expect.poll(async () => (await photoRows()).length, { timeout: 40_000 }).toBe(1);
  await expect(page.getByTestId("pending-badge")).toHaveCount(0, { timeout: 30_000 });
  await expect.poll(async () => (await queuedPhotos(page)).length).toBe(0);
  const [row] = await photoRows();
  expect(row).toMatchObject({
    customerId: customerIds[1],
    kind: "PARKING",
    isCurrent: true,
    uploadedById: userId,
    clientMutationId,
    width: 1600,
    height: 1067,
  });
  expect(uploadRequests).toHaveLength(1);

  // The live page shows the stored photo; a reload changes nothing and creates nothing.
  await page.goto(`/de/driver/stops/${stopIds[1]}`);
  await expect(visible(page, "photo-parking").getByTestId("photo-missing")).toHaveCount(0);
  await expect(visible(page, "photo-parking").getByTestId("photo-replace-parking")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
  expect(await photoRows()).toHaveLength(1);

  // The office sees it on the customer profile, with "updated by driver X on <date>".
  const adminContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const admin = await adminContext.newPage();
  await admin.route(/\/\d+\/\d+\/\d+\.png/, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: TILE }),
  );
  await admin.goto("/de/login");
  await admin.getByLabel("E-Mail").fill("admin@example.com");
  await admin.getByLabel("Passwort").fill(adminPassword);
  await admin.getByTestId("login-submit").click();
  await expect(admin).toHaveURL(/\/admin$/);
  await admin.goto(`/de/admin/customers/${customerIds[1]}`);
  const parking = admin.getByTestId("photo-slot-parking");
  await expect(parking.locator("img")).toBeVisible();
  expect(
    await parking
      .locator("img")
      .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
  ).toBe(true);
  const by = parking.getByTestId("photo-by-driver");
  await expect(by).toContainText(DRIVER_NAME);
  await expect(by).toContainText(/Aktualisiert von Fahrer/);
  await expect(admin.getByTestId("photo-slot-store")).toContainText("fehlt");
  await expect(admin.getByTestId("flag-photos-missing")).toBeVisible(); // STORE still missing
  expect(await noHorizontalScroll(admin)).toBe(true);
  await admin.screenshot({ path: testInfo.outputPath("photo-admin-profile.png"), fullPage: true });
  await admin.setViewportSize({ width: 375, height: 812 });
  expect(await noHorizontalScroll(admin)).toBe(true);
  await admin.screenshot({
    path: testInfo.outputPath("photo-admin-profile-375.png"),
    fullPage: true,
  });
  await adminContext.close();
  expect(errors).toEqual([]);
});

test("a lost answer is retried without a second photo or a second upload", async ({
  page,
  context,
}, testInfo) => {
  await readyOffline(page);
  const uploads: string[] = [];
  const registrations: Array<Record<string, string>> = [];
  page.on("request", (request) => {
    if (request.method() !== "POST") return;
    if (request.url().endsWith("/api/uploads")) uploads.push(request.url());
    if (request.url().endsWith("/api/driver/photos")) {
      registrations.push(JSON.parse(request.postData() ?? "{}"));
    }
  });
  // The server receives the first registration, but the answer never arrives.
  let seen = 0;
  await page.route("**/api/driver/photos", async (route) => {
    seen += 1;
    if (seen === 1) {
      await route.fetch();
      await route.abort("failed");
    } else {
      await route.continue();
    }
  });

  await page.goto(`/de/driver/stops/${stopIds[2]}`);
  await visible(page, "photo-input-store").setInputFiles(shot(1200, 900, [90, 60, 200]));
  await visible(page, "photo-confirm").click();

  await expect.poll(() => registrations.length, { timeout: 40_000 }).toBe(2);
  expect(registrations[0]!.clientMutationId).toBe(registrations[1]!.clientMutationId);
  expect(registrations[0]!.storageKey).toBe(registrations[1]!.storageKey);
  await expect(page.getByTestId("pending-badge")).toHaveCount(0, { timeout: 30_000 });
  await expect.poll(async () => (await queuedPhotos(page)).length).toBe(0);
  expect(await photoRows()).toHaveLength(1);
  expect(uploads).toHaveLength(1);
  await expect(visible(page, "photo-store").getByTestId("photo-missing")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("photo-retried.png"), fullPage: true });
  void context;
});

test("retaking replaces the unsent photo of the slot; the registered one stays as history", async ({
  page,
  context,
}) => {
  await readyOffline(page);
  await setOnline(context, page, false);
  await page.goto(`/de/driver/stops/${stopIds[0]}`).catch(() => {});
  const slot = visible(page, "photo-store");
  await slot.getByTestId("photo-input-store").setInputFiles(shot(800, 600, [255, 0, 0]));
  await slot.getByTestId("photo-confirm").click();
  await expect(page.getByTestId("pending-badge")).toHaveAttribute("data-count", "1");
  // A second shot of the same slot while still offline replaces the first in the queue.
  await slot.getByTestId("photo-input-store").setInputFiles(shot(800, 600, [0, 0, 255]));
  await slot.getByTestId("photo-confirm").click();
  await expect.poll(async () => (await queuedPhotos(page)).length).toBe(1);
  await expect(page.getByTestId("pending-badge")).toHaveAttribute("data-count", "1");

  await setOnline(context, page, true);
  await expect.poll(async () => (await photoRows()).length, { timeout: 40_000 }).toBe(1);
  await expect(page.getByTestId("pending-badge")).toHaveCount(0, { timeout: 30_000 });

  // Online again: replacing a registered photo keeps the old one as history.
  await page.goto(`/de/driver/stops/${stopIds[0]}`);
  await visible(page, "photo-input-store").setInputFiles(shot(800, 600, [0, 255, 0]));
  await visible(page, "photo-confirm").click();
  await expect.poll(async () => (await photoRows()).length, { timeout: 30_000 }).toBe(2);
  const rows = await photoRows(0);
  expect(rows.map((r) => r.isCurrent)).toEqual([false, true]);
  expect(new Set(rows.map((r) => r.clientMutationId)).size).toBe(2);
});

test("the registration endpoint accepts nothing without a driver session", async ({
  playwright,
  baseURL,
}) => {
  const anon = await playwright.request.newContext({ baseURL });
  const res = await anon.post("/api/driver/photos", {
    data: { clientMutationId: "x" },
    maxRedirects: 0,
  });
  expect(res.status()).toBe(401);
  expect(res.headers()["cache-control"]).toBe("private, no-store");
  await anon.dispose();
});

test("placeholder and capture buttons in Traditional Chinese (TW), 375 px", async ({
  page,
}, testInfo) => {
  await login(page);
  await page.goto(`/zh-Hant-TW/driver/stops/${stopIds[2]}`);
  const slot = visible(page, "photo-store");
  await expect(slot.getByTestId("photo-take-store")).toHaveText(/拍照/);
  await slot.getByTestId("photo-input-store").setInputFiles(shot(600, 400, [10, 90, 200]));
  await expect(slot.getByTestId("photo-confirm")).toHaveText(/使用此照片/);
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("photo-preview-zh-hant-tw.png"),
    fullPage: true,
  });
});
