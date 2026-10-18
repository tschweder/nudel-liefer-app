import { expect, type Page } from "@playwright/test";
import bcrypt from "bcryptjs";
import { Client } from "pg";

import { png } from "./png";

/**
 * Shared data for the driver usability / accessibility specs (NUD-095): an own driver, products,
 * three customers and a released tour for TODAY in the factory time zone.
 *   stop 0: both photos, notes, delivery hours, two products
 *   stop 1: store photo only
 *   stop 2: no photos, no notes
 * Photo requests (signed URLs into the private bucket) and map tiles are answered by the test.
 */
export const PIN = "482916";
export const LOCALES = ["de", "zh-Hans", "zh-Hant-HK", "zh-Hant-TW"] as const;
export type Locale = (typeof LOCALES)[number];

const TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const text = (de: string, hans: string, hk: string, tw: string) =>
  JSON.stringify({
    de,
    "zh-Hans": hans,
    "zh-Hant-HK": hk,
    "zh-Hant-TW": tw,
    meta: { source: "de", machine: {}, updatedAt: "2099-01-01T00:00:00Z" },
  });

export type DriverFixture = Awaited<ReturnType<typeof createDriverFixture>>;

export async function createDriverFixture(prefix: string, stopCount = 3) {
  const tag = `${prefix}${Date.now() % 1e8}${Math.floor(Math.random() * 1e4)}`;
  const username = `drv-${tag}`;
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const userId = `id-${tag}`;
  await db.query(
    `INSERT INTO "User" ("id","role","username","passwordHash","locale","localeChosen","displayName","updatedAt")
     VALUES ($1,'DRIVER',$2,$3,'de',true,'A11y Driver',now())`,
    [userId, username, await bcrypt.hash(PIN, 10)],
  );
  const kg = `prod-kg-${tag}`;
  const pack = `prod-pk-${tag}`;
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
  const tz =
    ((await db.query(`SELECT "timezone" FROM "Settings"`)).rows[0] as { timezone: string })
      ?.timezone ?? "Europe/Vienna";
  const today = (await db.query(`SELECT (now() AT TIME ZONE $1)::date AS d`, [tz])).rows[0]
    .d as Date;
  const tourId = `tour-${tag}`;
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
  const stopIds: string[] = [];
  const names = Array.from({ length: stopCount }, (_, n) => `Trattoria ${n + 1} ${tag}`);
  for (let i = 0; i < stopCount; i++) {
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
        i === 0
          ? text(
              "Hintereingang benutzen, im Hof klingeln",
              "请走后门，在院子里按铃",
              "請走後門，在院子裡按鈴",
              "請走後門，在院子裡按鈴",
            )
          : null,
        i === 0 ? "Mo-Fr 8-11 Uhr" : null,
      ],
    );
    if (i < 2) {
      for (const kind of ["STORE", "PARKING"]) {
        if (i === 1 && kind === "PARKING") continue;
        await db.query(
          `INSERT INTO "Photo" ("id","customerId","kind","storageKey","width","height","bytes","uploadedById","isCurrent")
           VALUES ($1,$2,$3::"PhotoKind",$4,800,600,100,$5,true)`,
          [
            `photo-${kind}-${i}-${tag}`,
            customerId,
            kind,
            `customers/${tag.padEnd(8, "0").slice(0, 8)}-0000-4000-8000-${String(i)}${kind === "STORE" ? "1" : "2"}0000000000.jpg`,
            userId,
          ],
        );
      }
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
        JSON.stringify(items[i] ?? [{ productId: i % 2 ? kg : pack, quantityCents: 500 + i * 50 }]),
      ],
    );
  }

  return {
    tag,
    username,
    userId,
    tourId,
    stopIds,
    names,
    db,
    /** Fresh state: all stops pending, tour released, picker not yet answered when asked. */
    async reset({
      localeChosen = true,
      locale = "de",
    }: { localeChosen?: boolean; locale?: Locale } = {}) {
      await db.query(`DELETE FROM "StopMutation" WHERE "stopId" = ANY($1)`, [stopIds]);
      await db.query(
        `UPDATE "Stop" SET "status"='PENDING', "problemReason"=NULL, "problemNote"=NULL, "completedAt"=NULL, "clientMutationId"=NULL WHERE "tourId"=$1`,
        [tourId],
      );
      await db.query(`UPDATE "Tour" SET "status"='RELEASED', "completedAt"=NULL WHERE "id"=$1`, [
        tourId,
      ]);
      await db.query(`UPDATE "User" SET "locale"=$2::"Locale", "localeChosen"=$3 WHERE "id"=$1`, [
        userId,
        locale,
        localeChosen,
      ]);
    },
    /** Every stop done (two delivered, one problem) and the tour completed: the finished screen. */
    async finishTour() {
      await db.query(
        `UPDATE "Stop" SET "status"='DELIVERED', "completedAt"=now() WHERE "tourId"=$1 AND "sequence"<3`,
        [tourId],
      );
      await db.query(
        `UPDATE "Stop" SET "status"='PROBLEM', "problemReason"='CLOSED', "completedAt"=now() WHERE "tourId"=$1 AND "sequence"=3`,
        [tourId],
      );
      await db.query(`UPDATE "Tour" SET "status"='COMPLETED', "completedAt"=now() WHERE "id"=$1`, [
        tourId,
      ]);
    },
    async cleanup() {
      await db.query(`DELETE FROM "StopMutation" WHERE "stopId" = ANY($1)`, [stopIds]);
      await db.query(`DELETE FROM "Stop" WHERE "tourId"=$1`, [tourId]);
      await db.query(`DELETE FROM "Tour" WHERE "id"=$1`, [tourId]);
      await db.query(`DELETE FROM "Photo" WHERE "id" LIKE $1`, [`photo-%-${tag}`]);
      await db.query(`DELETE FROM "Customer" WHERE "id" LIKE $1`, [`cust-%-${tag}`]);
      await db.query(`DELETE FROM "Product" WHERE "id" LIKE $1`, [`prod-%-${tag}`]);
      await db
        .query(`DELETE FROM "LoginAttempt" WHERE "key" LIKE $1`, [`%${username}%`])
        .catch(() => {});
      await db.query(`DELETE FROM "User" WHERE "id" = $1`, [userId]);
      await db.end();
    },
  };
}

/** Answers map tiles and the (signed, private) photo requests with small local images. */
export async function stubImages(page: Page) {
  await page.route(/\/\d+\/\d+\/\d+\.png/, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: TILE }),
  );
  await page.route(/\/customers\/[^/]+\.jpg/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/png",
      body: png(800, 600, route.request().url().includes("-1") ? [200, 120, 60] : [60, 120, 200]),
    }),
  );
}

export async function loginDriver(page: Page, fixture: { username: string }, locale = "de") {
  await stubImages(page);
  await page.goto(`/${locale}/driver/login`);
  const form = page.getByTestId("driver-login-form");
  await form.locator('input[name="username"]').fill(fixture.username);
  await form.locator('input[name="pin"]').fill(PIN);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/driver(\/start)?$/);
}
