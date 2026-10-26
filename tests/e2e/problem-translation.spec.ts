import { expect, type Page, test } from "@playwright/test";
import bcrypt from "bcryptjs";
import { Client } from "pg";

// NUD-072. Needs DATABASE_URL and SEED_ADMIN_PASSWORD (seeded admin) and the Fake translator (no
// DEEPL_API_KEY): translated text carries a "[de] " prefix. The spec inserts its own zh-Hant-HK
// driver, customers and a released tour for TODAY, lets the driver report a problem with Chinese
// free text in the real driver UI and checks the German translation, the machine marker, the
// original toggle and the "translation pending" state on the admin tour page. Run it alone: it
// owns "today's tour" of the database.
test.use({ viewport: { width: 1280, height: 800 } });

const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "change-me-local-only";
const PIN = "482916";
const tag = `ptr${Date.now() % 1e8}${Math.floor(Math.random() * 1e4)}`;
const username = `drv-${tag}`;
const TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
let db: Client;
let userId: string;
let tourId: string;
let today: string;
const stopIds: string[] = [];
const names = [1, 2, 3].map((n) => `Trattoria ${n} ${tag}`);

test.beforeAll(async () => {
  db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const hash = await bcrypt.hash(PIN, 10);
  userId = `id-${tag}`;
  await db.query(
    `INSERT INTO "User" ("id","role","username","passwordHash","locale","localeChosen","displayName","updatedAt")
     VALUES ($1,'DRIVER',$2,$3,'zh-Hant-HK',true,'Translation Driver',now())`,
    [userId, username, hash],
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
  const row = (
    await db.query(
      `SELECT (now() AT TIME ZONE $1)::date AS d, to_char(now() AT TIME ZONE $1, 'YYYY-MM-DD') AS s`,
      [tz],
    )
  ).rows[0] as { d: Date; s: string };
  today = row.s;
  tourId = `tour-${tag}`;
  await db.query(
    `INSERT INTO "Tour" ("id","date","driverId","status","depotSnapshot","releaseRevision","releasedAt","updatedAt")
     VALUES ($1,$2,$3,'RELEASED',$4::jsonb,1,now(),now())`,
    [
      tourId,
      row.d,
      userId,
      JSON.stringify({ name: "Depot", address: "Graben 1", lat: 48.2082, lng: 16.3738 }),
    ],
  );
  for (let i = 0; i < 2; i++) {
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
        new Date(row.d.getTime() + (8 + i) * 3600_000),
        JSON.stringify([{ productId: kg, quantity: 1250 + i * 100 }]),
      ],
    );
  }
});

test.afterAll(async () => {
  await db.query(`DELETE FROM "StopMutation" WHERE "stopId" = ANY($1)`, [stopIds]);
  await db.query(`DELETE FROM "Stop" WHERE "tourId"=$1`, [tourId]);
  await db.query(`DELETE FROM "Tour" WHERE "id"=$1`, [tourId]);
  await db.query(`DELETE FROM "Customer" WHERE "id" LIKE $1`, [`cust-%-${tag}`]);
  await db.query(`DELETE FROM "Product" WHERE "id" LIKE $1`, [`prod-%-${tag}`]);
  await db
    .query(`DELETE FROM "LoginAttempt" WHERE "key" LIKE $1`, [`%${username}%`])
    .catch(() => {});
  await db.query(`DELETE FROM "User" WHERE "id" = $1`, [userId]);
  await db.end();
});

const visible = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`);
const stubTiles = (page: Page) =>
  page.route(/\/\d+\/\d+\/\d+\.png/, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: TILE }),
  );
const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

const NOTE_HK = "門口鎖住了，沒人應門";

test("a Cantonese driver's problem text reaches the office as German with the original behind a toggle", async ({
  browser,
}, testInfo) => {
  test.setTimeout(150_000);
  const adminCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const admin = await adminCtx.newPage();
  await stubTiles(admin);
  await admin.goto("/de/login");
  await admin.getByLabel("E-Mail").fill("admin@example.com");
  await admin.getByLabel("Passwort").fill(adminPassword);
  await visible(admin, "login-submit").click();
  await expect(admin).toHaveURL(/\/admin$/);

  // The driver works in zh-Hant-HK on a phone and reports a problem with free text.
  const driverCtx = await browser.newContext({
    viewport: { width: 375, height: 812 },
    hasTouch: true,
  });
  const driver = await driverCtx.newPage();
  await stubTiles(driver);
  await driver.goto("/zh-Hant-HK/driver/login");
  const form = driver.getByTestId("driver-login-form");
  await form.locator('input[name="username"]').fill(username);
  await form.locator('input[name="pin"]').fill(PIN);
  await driver.getByTestId("login-submit").click();
  await expect(driver).toHaveURL(/\/zh-Hant-HK\/driver$/);
  await driver.goto(`/zh-Hant-HK/driver/stops/${stopIds[0]}`);
  await visible(driver, "btn-problem").click();
  await driver.getByTestId("reason-CLOSED").click();
  await driver.getByTestId("problem-note").fill(NOTE_HK);
  const submitted = Date.now();
  await driver.getByTestId("problem-submit").click();
  await expect
    .poll(
      async () =>
        (await db.query(`SELECT "status" FROM "Stop" WHERE "id"=$1`, [stopIds[0]])).rows[0].status,
    )
    .toBe("PROBLEM");
  // The driver was not held up by the translation (it runs after the response).
  testInfo.annotations.push({
    type: "driver-roundtrip-ms",
    description: String(Date.now() - submitted),
  });

  // The translation lands in the database shortly after (Fake translator: "[de] " prefix).
  await expect
    .poll(
      async () =>
        (await db.query(`SELECT "problemNote" FROM "Stop" WHERE "id"=$1`, [stopIds[0]])).rows[0]
          .problemNote?.de ?? null,
      { timeout: 20_000 },
    )
    .toBe(`[de] ${NOTE_HK}`);
  const stored = (await db.query(`SELECT "problemNote" FROM "Stop" WHERE "id"=$1`, [stopIds[0]]))
    .rows[0].problemNote;
  expect(stored["zh-Hant-HK"]).toBe(NOTE_HK);
  expect(stored.meta.pendingTranslation).toBeUndefined();

  // Admin tour page: German translation first (machine marker), original on demand.
  await admin.goto(`/de/admin/tours?date=${today}`);
  const row = admin.locator(`[data-stop-id="${stopIds[0]}"]:visible`);
  await expect(row.getByTestId("stop-problem-reason")).toContainText("Geschlossen");
  await expect(row.getByTestId("stop-problem-german")).toContainText(`[de] ${NOTE_HK}`);
  await expect(row.getByTestId("stop-problem-machine")).toHaveText("maschinell übersetzt");
  await expect(row.getByTestId("stop-problem-original")).toHaveCount(0);
  expect(await noHorizontalScroll(admin)).toBe(true);
  await admin.screenshot({ path: testInfo.outputPath("nud-072-tour-german.png"), fullPage: true });

  await row.getByTestId("stop-problem-toggle").click();
  await expect(row.getByTestId("stop-problem-original")).toContainText(NOTE_HK);
  await expect(row.getByTestId("stop-problem-original").locator("q")).toHaveAttribute(
    "lang",
    "zh-Hant-HK",
  );
  await expect(row.getByTestId("stop-problem-original")).toContainText("Originaltext des Fahrers");
  await admin.screenshot({
    path: testInfo.outputPath("nud-072-tour-original.png"),
    fullPage: true,
  });
  await row.getByTestId("stop-problem-toggle").click();
  await expect(row.getByTestId("stop-problem-original")).toHaveCount(0);

  // Same data in the Chinese UI: strings exist, German text and original still reachable.
  await admin.goto(`/zh-Hans/admin/tours?date=${today}`);
  const rowZh = admin.locator(`[data-stop-id="${stopIds[0]}"]:visible`);
  await expect(rowZh.getByTestId("stop-problem-german")).toContainText(`[de] ${NOTE_HK}`);
  await rowZh.getByTestId("stop-problem-toggle").click();
  await expect(rowZh.getByTestId("stop-problem-original")).toContainText(NOTE_HK);

  // Pending state: a Chinese note whose translation has not arrived yet.
  await db.query(
    `UPDATE "Stop" SET "status"='PROBLEM',"problemReason"='NOBODY_THERE',"completedAt"=now(),"problemNote"=$2::jsonb WHERE "id"=$1`,
    [
      stopIds[1],
      JSON.stringify({
        "zh-Hans": "没人在",
        "zh-Hant-HK": "沒人在",
        "zh-Hant-TW": "沒人在",
        meta: {
          source: "zh-Hant-HK",
          machine: { "zh-Hans": true },
          updatedAt: new Date().toISOString(),
          pendingTranslation: true,
        },
      }),
    ],
  );
  await admin.goto(`/de/admin/tours?date=${today}`);
  const row2 = admin.locator(`[data-stop-id="${stopIds[1]}"]:visible`);
  await expect(row2.getByTestId("stop-problem-pending")).toHaveText("Übersetzung folgt");
  await expect(row2.getByTestId("stop-problem-original")).toContainText("沒人在");
  await expect(row2.getByTestId("stop-problem-toggle")).toHaveCount(0);
  await admin.screenshot({ path: testInfo.outputPath("nud-072-tour-pending.png"), fullPage: true });

  await driverCtx.close();
  await adminCtx.close();
});
