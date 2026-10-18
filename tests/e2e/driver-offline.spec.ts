import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { expect, type Page, test } from "@playwright/test";
import bcrypt from "bcryptjs";
import { Client } from "pg";

import { installNetworkEmulation, setOnline } from "./helpers/network";
import { png } from "./helpers/png";

// NUD-081. Needs DATABASE_URL, S3_* (the spec uploads its photos to the S3-compatible store; the
// browser downloads them through the signed URLs of the tour API) and a PRODUCTION build
// (`pnpm build && pnpm start`): the service worker only exists there. Own driver, products,
// customers and a released tour for TODAY in the factory time zone. Phone viewport.
test.use({ viewport: { width: 375, height: 812 } });

const PIN = "482916";
const tag = `offl${Date.now() % 1e8}${Math.floor(Math.random() * 1e4)}`;
const username = `drv-${tag}`;
const LOCALES = ["de", "zh-Hans", "zh-Hant-HK", "zh-Hant-TW"] as const;
const TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

let db: Client;
let userId: string;
let otherUserId: string;
let tourId: string;
const stopIds: string[] = [];
const names = [1, 2, 3].map((n) => `Trattoria ${n} ${tag}`);
const photoKeys: string[] = [];

const text = (de: string, hans?: string, hk?: string, tw?: string) =>
  JSON.stringify({
    de,
    ...(hans ? { "zh-Hans": hans, "zh-Hant-HK": hk, "zh-Hant-TW": tw } : {}),
    meta: { source: "de", machine: {}, updatedAt: "2099-01-01T00:00:00Z" },
  });

test.beforeAll(async () => {
  db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const hash = await bcrypt.hash(PIN, 10);
  userId = `id-${tag}`;
  otherUserId = `id2-${tag}`;
  await db.query(
    `INSERT INTO "User" ("id","role","username","passwordHash","locale","localeChosen","displayName","updatedAt")
     VALUES ($1,'DRIVER',$2,$3,'de',true,'Offline Driver',now()), ($4,'DRIVER',$5,$3,'de',true,'Second Driver',now())`,
    [userId, username, hash, otherUserId, `drv2-${tag}`],
  );
  const kg = `prod-kg-${tag}`;
  const pack = `prod-pack-${tag}`;
  await db.query(
    `INSERT INTO "Product" ("id","sku","name","unit","updatedAt") VALUES ($1,$2,$3::jsonb,'KG',now()), ($4,$5,$6::jsonb,'PACK',now())`,
    [
      kg,
      `KG-${tag}`,
      text("Spaghetti lose", "意大利面", "意大利麵", "義大利麵"),
      pack,
      `PK-${tag}`,
      text("Penne", "笔管面", "筆管麵", "筆管麵"),
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
  const items = [
    [
      { productId: kg, quantityCents: 1250 },
      { productId: pack, quantityCents: 400 },
    ],
    [{ productId: kg, quantityCents: 2700 }],
    [{ productId: pack, quantityCents: 100 }],
  ];

  const s3 = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
    },
  });

  for (let i = 0; i < 3; i++) {
    const customerId = `cust-${i}-${tag}`;
    await db.query(
      `INSERT INTO "Customer" ("id","customerNumber","name","street","postalCode","city","lat","lng","pinConfirmed","notes","deliveryHoursInfo","updatedAt")
       VALUES ($1,$2,$3,'Hauptstraße 1','1010','Wien',$4,$5,true,$6::jsonb,$7,now())`,
      [
        customerId,
        `${tag}-${i}`,
        names[i],
        Number((48.2 + i / 100).toFixed(2)),
        Number((16.37 + i / 100).toFixed(2)),
        i === 0 ? text("Hintereingang benutzen", "请走后门", "請走後門", "請走後門") : null,
        i === 0 ? "Mo-Fr 8-11 Uhr" : null,
      ],
    );
    // Customer 0: shop + parking photo, customer 1: shop photo only, customer 2: none.
    const kinds = i === 0 ? ["STORE", "PARKING"] : i === 1 ? ["STORE"] : [];
    for (const kind of kinds) {
      const key = `customers/${tag}-${i}${kind === "STORE" ? "s" : "p"}.png`;
      photoKeys.push(key);
      await s3.send(
        new PutObjectCommand({
          Bucket: process.env.S3_BUCKET,
          Key: key,
          ContentType: "image/png",
          Body: png(800, 600, kind === "STORE" ? [200, 120, 60] : [60, 120, 200]),
        }),
      );
      await db.query(
        `INSERT INTO "Photo" ("id","customerId","kind","storageKey","width","height","bytes","uploadedById","isCurrent")
         VALUES ($1,$2,$3::"PhotoKind",$4,800,600,100,$5,true)`,
        [`photo-${kind}-${i}-${tag}`, customerId, kind, key, userId],
      );
    }
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
        JSON.stringify(items[i]),
      ],
    );
  }
});

test.afterAll(async () => {
  await db.query(`DELETE FROM "Stop" WHERE "tourId"=$1`, [tourId]);
  await db.query(`DELETE FROM "Tour" WHERE "id"=$1`, [tourId]);
  await db.query(`DELETE FROM "Photo" WHERE "id" LIKE $1`, [`photo-%-${tag}`]);
  await db.query(`DELETE FROM "Customer" WHERE "id" LIKE $1`, [`cust-%-${tag}`]);
  await db.query(`DELETE FROM "Product" WHERE "id" LIKE $1`, [`prod-%-${tag}`]);
  await db.query(`DELETE FROM "LoginAttempt" WHERE "key" LIKE $1`, [`%${tag}%`]).catch(() => {});
  await db.query(`DELETE FROM "User" WHERE "id" IN ($1,$2)`, [userId, otherUserId]);
  await db.end();
});

async function login(page: Page, name = username) {
  await page.route(/\/\d+\/\d+\/\d+\.png/, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: TILE }),
  );
  await page.goto("/de/driver/login");
  const form = page.getByTestId("driver-login-form");
  await form.locator('input[name="username"]').fill(name);
  await form.locator('input[name="pin"]').fill(PIN);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/de\/driver$/);
}

/** Logged in, tour and ALL photos stored, the worker controls the page. */
async function readyOffline(page: Page) {
  await login(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  // The first load may have happened before the worker took control: reload under its control.
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, undefined, {
    timeout: 30_000,
  });
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
}

type IdbRecord = {
  userId: string;
  savedAt: string;
  data: {
    schemaVersion: number;
    tour: {
      id: string;
      stops: Array<{ items: Array<{ quantityCents: number; name: unknown }> }>;
    };
  };
};

const idbRecords = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<IdbRecord[]>((resolve, reject) => {
        const open = indexedDB.open("nudel-driver-offline");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const database = open.result;
          if (!database.objectStoreNames.contains("tours")) {
            database.close();
            resolve([]);
            return;
          }
          const all = database.transaction("tours").objectStore("tours").getAll();
          all.onsuccess = () => {
            database.close();
            resolve(all.result);
          };
          all.onerror = () => reject(all.error);
        };
      }),
  );

const photoCacheKeys = (page: Page) =>
  page.evaluate(async () => {
    if (!(await caches.has("nudel-driver-photos-v1"))) return [];
    const cache = await caches.open("nudel-driver-photos-v1");
    return (await cache.keys()).map((r) => new URL(r.url).pathname);
  });

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ context }) => installNetworkEmulation(context));

test("the tour API is DRIVER-only", async ({ playwright, baseURL }) => {
  const anon = await playwright.request.newContext({ baseURL });
  const res = await anon.get("/api/driver/tour/today", { maxRedirects: 0 });
  expect(res.status()).toBe(401);
  expect(await res.json()).toEqual({ error: "unauthenticated" });
  expect(res.headers()["cache-control"]).toBe("private, no-store");
  await anon.dispose();
});

test("loads the tour into IndexedDB, prefetches the photos and says 'ready offline'", async ({
  page,
}) => {
  await readyOffline(page);
  await expect(page.getByTestId("offline-ready")).toHaveText(/Offline bereit ✓/);
  const records = await idbRecords(page);
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ userId, data: { schemaVersion: 1, tour: { id: tourId } } });
  expect(records[0]!.data.tour.stops).toHaveLength(3);
  // The tour JSON holds the texts of all four locales.
  expect(records[0]!.data.tour.stops[0].items[0].name).toMatchObject({
    de: "Spaghetti lose",
    "zh-Hans": "意大利面",
    "zh-Hant-HK": "意大利麵",
    "zh-Hant-TW": "義大利麵",
  });
  // Photos: three, keyed by stable photo URL (not by the signed storage URL).
  const keys = await photoCacheKeys(page);
  expect(keys.sort()).toEqual(
    [`photo-PARKING-0-${tag}`, `photo-STORE-0-${tag}`, `photo-STORE-1-${tag}`]
      .map((id) => `/api/driver/photo-cache/${id}`)
      .sort(),
  );
  // Nothing else: the worker's own caches keep only the shell and build assets, no personal data.
  const stored = await page.evaluate(async () => {
    const out: string[] = [];
    for (const name of await caches.keys()) {
      if (name === "nudel-driver-photos-v1") continue;
      for (const req of await (await caches.open(name)).keys()) out.push(new URL(req.url).pathname);
    }
    return out;
  });
  for (const u of stored) {
    expect(u, u).toMatch(
      /^(\/_next\/static\/|\/icons\/|\/offline\.html$|\/(de|zh-Hans|zh-Hant-HK|zh-Hant-TW)\/driver\/offline-shell$)/,
    );
  }
  expect(stored.some((u) => u.includes("/api/"))).toBe(false);
  await expect(page.getByTestId("offline-bar")).toHaveCount(0);
});

test("offline: tour list, stop details and photos still render (375 px)", async ({
  page,
  context,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await readyOffline(page);

  // What the server rendered while online, to compare with the offline rendering.
  const onlineList = await page.getByTestId("today-tour").innerText();
  await page.goto(`/de/driver/stops/${stopIds[0]}`);
  await expect(page.getByTestId("stop-detail")).toBeVisible();
  const onlineDetail = {
    header: await page.getByTestId("stop-header").innerText(),
    items: await page.getByTestId("stop-items").innerText(),
    info: await page.getByTestId("stop-info").innerText(),
  };
  const onlinePhotoBox = await page.getByTestId("photo-store").boundingBox();
  await page.goto("/de/driver");
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });

  await setOnline(context, page, false);
  try {
    // Cold navigation to the tour list while offline.
    await page.goto("/de/driver").catch(() => {});
    await expect(page.getByTestId("offline-bar")).toBeVisible();
    await expect(page.getByTestId("offline-bar")).toHaveText(
      /Offline – zuletzt aktualisiert \d{1,2}:\d{2}/,
    );
    await expect(page.getByTestId("connection-indicator")).toHaveAttribute("data-online", "false");
    await expect(page.locator('[data-testid="stop-row"]:visible')).toHaveCount(3);
    for (const name of names) await expect(page.getByTestId("today-tour")).toContainText(name);
    await expect(page.getByTestId("progress-count")).toHaveText(/0\s*\/\s*3/);
    await expect(page.getByTestId("next-stop")).toContainText(names[0]!);
    // Same screen as online: the list text is identical.
    expect(await page.getByTestId("today-tour").innerText()).toBe(onlineList);
    expect(await noHorizontalScroll(page)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("offline-list-de.png"), fullPage: true });

    // Open a stop by tapping it (Next falls back to a normal page load, the worker serves the shell).
    await page.locator('[data-testid="stop-row"]:visible').first().getByRole("link").click();
    await expect(page).toHaveURL(new RegExp(`/de/driver/stops/${stopIds[0]}$`));
    await expect(page.getByTestId("stop-detail")).toBeVisible();
    await expect(page.getByTestId("stop-name")).toHaveText(names[0]!);
    expect(await page.getByTestId("stop-header").innerText()).toBe(onlineDetail.header);
    expect(await page.getByTestId("stop-items").innerText()).toBe(onlineDetail.items);
    expect(await page.getByTestId("stop-info").innerText()).toBe(onlineDetail.info);
    await expect(page.getByTestId("stop-item").first().getByTestId("item-quantity")).toContainText(
      /12[.,]5/,
    );
    // Both photos are shown from the cache.
    for (const kind of ["store", "parking"]) {
      const img = page.getByTestId(`photo-${kind}`).locator("img");
      await expect(img).toBeVisible();
      await expect(img).toHaveAttribute("src", /\/api\/driver\/photo-cache\/photo-/);
      await expect
        .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth))
        .toBe(800);
    }
    const offlinePhotoBox = await page.getByTestId("photo-store").boundingBox();
    expect(Math.round(offlinePhotoBox!.height)).toBe(Math.round(onlinePhotoBox!.height));
    // The status cannot be changed offline (queue is NUD-082): visible but disabled, with a notice.
    await expect(page.getByTestId("status-offline-notice")).toBeVisible();
    await expect(page.getByTestId("btn-delivered")).toBeDisabled();
    await expect(page.getByTestId("btn-problem")).toBeDisabled();
    expect(await noHorizontalScroll(page)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("offline-stop-de.png"), fullPage: true });

    // Next stop (shop photo only), then the stop without any photo; direct URL works as well.
    await page.getByTestId("next-stop").click();
    await expect(page).toHaveURL(new RegExp(`/stops/${stopIds[1]}$`));
    await expect(page.getByTestId("stop-name")).toHaveText(names[1]!);
    await expect(page.getByTestId("photo-store").locator("img")).toBeVisible();
    await expect(page.getByTestId("photo-parking").getByTestId("photo-missing")).toBeVisible();
    await page.goto(`/de/driver/stops/${stopIds[2]}`).catch(() => {});
    await expect(page.getByTestId("stop-name")).toHaveText(names[2]!);
    await expect(page.getByTestId("photo-missing")).toHaveCount(2);

    // A stop that is not in the cached tour.
    await page.goto("/de/driver/stops/does-not-exist").catch(() => {});
    await expect(page.getByTestId("offline-stop-missing")).toBeVisible();
    await page.getByRole("link", { name: "Zur Tour" }).click();
    await expect(page.locator('[data-testid="stop-row"]:visible')).toHaveCount(3);
    // Nothing leaks into the generic offline page.
    await expect(page.locator("h1:visible")).toHaveCount(0);
  } finally {
    await setOnline(context, page, true);
  }
  expect(errors).toEqual([]);
});

for (const locale of LOCALES.slice(1)) {
  test(`offline in ${locale}: texts come from the cached all-locale data`, async ({
    page,
    context,
  }, testInfo) => {
    await readyOffline(page);
    await setOnline(context, page, false);
    try {
      await page.goto(`/${locale}/driver/stops/${stopIds[0]}`).catch(() => {});
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page.getByTestId("stop-name")).toHaveText(names[0]!);
      await expect(page.getByTestId("offline-bar")).toBeVisible();
      const expected =
        locale === "zh-Hans" ? "意大利面" : locale === "zh-Hant-HK" ? "意大利麵" : "義大利麵";
      const first = page.getByTestId("stop-item").first();
      await expect(first.getByTestId("item-name")).toHaveText(expected);
      await expect(first.getByTestId("item-name-de")).toHaveText("Spaghetti lose");
      // Customer note: the Chinese text exists, so no "DE" badge.
      await expect(page.getByTestId("stop-notes")).toContainText(
        locale === "zh-Hans" ? "请走后门" : "請走後門",
      );
      await expect(page.getByTestId("notes-lang")).toHaveCount(0);
      await expect(page.getByTestId("photo-store").locator("img")).toBeVisible();
      expect(await noHorizontalScroll(page)).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`offline-stop-${locale}.png`),
        fullPage: true,
      });
    } finally {
      await setOnline(context, page, true);
    }
  });
}

test("back online: the shell leaves for the live page and the copy stays ready", async ({
  page,
  context,
}) => {
  await readyOffline(page);
  await setOnline(context, page, false);
  await page.goto("/de/driver").catch(() => {});
  await expect(page.getByTestId("offline-bar")).toBeVisible();
  await setOnline(context, page, true);
  // The shell reloads itself; the server page (no offline bar, live data) takes over.
  await expect(page.getByTestId("offline-bar")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-testid="stop-row"]:visible')).toHaveCount(3);
});

test("a changed tour is refreshed in the background when the connection returns", async ({
  page,
  context,
}) => {
  await readyOffline(page);
  const before = (await idbRecords(page))[0]!.savedAt as string;
  await setOnline(context, page, false);
  await expect(page.getByTestId("offline-bar")).toBeVisible();
  // Office change while the driver is offline: quantity of stop 3 (snapshot, as after a re-release).
  await db.query(
    `UPDATE "Stop" SET "items"='[{"productId":"prod-pack-${tag}","quantityCents":900}]'::jsonb WHERE "id"=$1`,
    [stopIds[2]],
  );
  await setOnline(context, page, true);
  await expect
    .poll(async () => (await idbRecords(page))[0]?.savedAt as string, { timeout: 30_000 })
    .not.toBe(before);
  const records = await idbRecords(page);
  expect(records[0]!.data.tour.stops[2].items[0].quantityCents).toBe(900);
  await db.query(
    `UPDATE "Stop" SET "items"='[{"productId":"prod-pack-${tag}","quantityCents":100}]'::jsonb WHERE "id"=$1`,
    [stopIds[2]],
  );
});

test("data of other users and of previous days is purged", async ({ page, context }) => {
  await readyOffline(page);
  // Plant another user's copy and an outdated copy of the same user.
  await page.evaluate(async () => {
    const open = indexedDB.open("nudel-driver-offline");
    await new Promise<void>((resolve, reject) => {
      open.onsuccess = () => {
        const database = open.result;
        const tx = database.transaction("tours", "readwrite");
        const store = tx.objectStore("tours");
        store.getAll().onsuccess = (ev) => {
          const [mine] = (ev.target as IDBRequest).result as Array<
            { data: Record<string, unknown> } & Record<string, unknown>
          >;
          store.put({ ...mine, userId: "someone-else" });
        };
        tx.oncomplete = () => {
          database.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  });
  expect((await idbRecords(page)).map((r) => r.userId).sort()).toContain("someone-else");
  // The next sync of this driver removes the other user's data.
  await page.reload();
  await expect(page.getByTestId("offline-ready")).toBeVisible();
  await expect.poll(async () => (await idbRecords(page)).map((r) => r.userId)).toEqual([userId]);

  // Yesterday's copy is never shown and is deleted.
  await page.evaluate(async () => {
    const open = indexedDB.open("nudel-driver-offline");
    await new Promise<void>((resolve, reject) => {
      open.onsuccess = () => {
        const database = open.result;
        const tx = database.transaction("tours", "readwrite");
        const store = tx.objectStore("tours");
        store.getAll().onsuccess = (ev) => {
          const [mine] = (ev.target as IDBRequest).result as Array<
            { data: Record<string, unknown> } & Record<string, unknown>
          >;
          store.put({ ...mine, date: "2000-01-01", data: { ...mine.data, date: "2000-01-01" } });
        };
        tx.oncomplete = () => {
          database.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  });
  await setOnline(context, page, false);
  try {
    await page.goto("/de/driver").catch(() => {});
    await expect(page.getByTestId("offline-empty")).toBeVisible();
    await expect(page.getByTestId("offline-empty")).toContainText("Keine gespeicherte Tour");
    await expect(page.locator("body")).not.toContainText(names[0]!);
    expect(await idbRecords(page)).toEqual([]);
  } finally {
    await setOnline(context, page, true);
  }
});

test("logout removes the cached tour and the photos from the device", async ({ page, context }) => {
  await readyOffline(page);
  expect(await idbRecords(page)).toHaveLength(1);
  expect(await photoCacheKeys(page)).toHaveLength(3);

  await page.getByTestId("logout").click();
  await expect(page).toHaveURL(/\/de\/driver\/login/);
  await expect.poll(() => idbRecords(page)).toEqual([]);
  await expect.poll(() => photoCacheKeys(page)).toEqual([]);

  // Offline afterwards: no personal data anywhere, not even in the shell.
  await setOnline(context, page, false);
  try {
    await page.goto("/de/driver").catch(() => {});
    await expect(page.getByTestId("offline-empty")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(names[0]!);
    await expect(page.locator("body")).not.toContainText("Offline Driver");
  } finally {
    await setOnline(context, page, true);
  }
});

test("a different driver signing in gets his own copy and none of the previous driver's data", async ({
  page,
}) => {
  await readyOffline(page);
  await page.getByTestId("logout").click();
  await expect(page).toHaveURL(/\/de\/driver\/login/);
  await login(page, `drv2-${tag}`);
  // The second driver has no tour today: nothing is stored for him.
  await expect(page.getByTestId("empty-state")).toBeVisible();
  await expect.poll(() => idbRecords(page)).toEqual([]);
  await expect.poll(() => photoCacheKeys(page)).toEqual([]);
});
