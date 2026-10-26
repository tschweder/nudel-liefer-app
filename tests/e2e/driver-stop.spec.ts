import { deflateSync } from "node:zlib";

import { expect, type Page, test } from "@playwright/test";
import bcrypt from "bcryptjs";
import { Client } from "pg";

// NUD-052. Needs DATABASE_URL and S3_* (photo read URLs are signed by the server; the image
// requests themselves are answered by the test). The spec inserts its own driver, products,
// customers and a released tour for TODAY in the factory time zone. Phone viewport.
test.use({ viewport: { width: 375, height: 812 } });

const PIN = "482916";
const tag = `stopd${Date.now() % 1e8}${Math.floor(Math.random() * 1e4)}`;
const username = `drv-${tag}`;
const otherUsername = `drv2-${tag}`;
const LOCALES = ["de", "en", "sr-Latn", "cs", "zh-Hans"] as const;
const TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/** A valid RGB PNG with a diagonal gradient (so two photos differ), built without dependencies. */
function png(width: number, height: number, [r, g, b]: [number, number, number]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc(body));
    return Buffer.concat([head, body, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x++) {
      const t = (x + y) / (width + height);
      row[1 + x * 3] = Math.round(r * t);
      row[2 + x * 3] = Math.round(g * (1 - t));
      row[3 + x * 3] = b;
    }
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

let db: Client;
let userId: string;
let otherUserId: string;
let tourId: string;
const stopIds: string[] = [];
const names = [1, 2, 3].map((n) => `Trattoria ${n} ${tag}`);

const text = (de: string, hans?: string) =>
  JSON.stringify({
    de,
    ...(hans
      ? { "zh-Hans": hans, en: `${de} (en)`, "sr-Latn": `${de} (sr)`, cs: `${de} (cs)` }
      : {}),
    meta: { source: "de", machine: {}, updatedAt: "2099-01-01T00:00:00Z" },
  });

test.beforeAll(async () => {
  db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const hash = await bcrypt.hash(PIN, 10);
  userId = `id-${tag}`;
  otherUserId = `id2-${tag}`;
  for (const [id, name] of [
    [userId, username],
    [otherUserId, otherUsername],
  ]) {
    await db.query(
      `INSERT INTO "User" ("id","role","username","passwordHash","locale","localeChosen","displayName","updatedAt")
       VALUES ($1,'DRIVER',$2,$3,'de',true,'Stop Driver',now())`,
      [id, name, hash],
    );
  }
  const kg = `prod-kg-${tag}`;
  const pack = `prod-pack-${tag}`;
  await db.query(
    `INSERT INTO "Product" ("id","sku","name","unit","weightKgPerUnit","updatedAt") VALUES ($1,$2,$3::jsonb,'KG',1,now()), ($4,$5,$6::jsonb,'PACK',3,now())`,
    [
      kg,
      `KG-${tag}`,
      text("Spaghetti lose", "意大利面"),
      pack,
      `PK-${tag}`,
      text("Penne", "笔管面"),
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
      { productId: kg, quantity: 13 },
      { productId: pack, quantity: 4 },
    ],
    [{ productId: kg, quantity: 27 }],
    [{ productId: pack, quantity: 1 }],
  ];
  for (let i = 0; i < 3; i++) {
    const customerId = `cust-${i}-${tag}`;
    // Customer 1 has photos, notes and hours; customer 2 has none of it.
    await db.query(
      `INSERT INTO "Customer" ("id","customerNumber","name","street","postalCode","city","lat","lng","pinConfirmed","notes","deliveryHoursInfo","updatedAt")
       VALUES ($1,$2,$3,'Hauptstraße 1','1010','Wien',$4,$5,true,$6::jsonb,$7,now())`,
      [
        customerId,
        `${tag}-${i}`,
        names[i],
        Number((48.2 + i / 100).toFixed(2)),
        Number((16.37 + i / 100).toFixed(2)),
        i === 0 ? text("Hintereingang benutzen, im Hof klingeln") : null,
        i === 0 ? "Mo-Fr 8-11 Uhr" : null,
      ],
    );
    if (i < 2) {
      for (const kind of ["STORE", "PARKING"]) {
        // Customer 1 only has the shop photo.
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
  await db
    .query(`DELETE FROM "LoginAttempt" WHERE "key" LIKE $1 OR "key" LIKE $2`, [
      `%${username}%`,
      `%${otherUsername}%`,
    ])
    .catch(() => {});
  await db.query(`DELETE FROM "User" WHERE "id" IN ($1,$2)`, [userId, otherUserId]);
  await db.end();
});

async function login(page: Page, name = username) {
  await page.route(/\/\d+\/\d+\/\d+\.png/, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: TILE }),
  );
  // Photos live in the (private) bucket; the server only signs the URLs, the test serves the bytes.
  await page.route(/\/customers\/[^/]+\.jpg/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/png",
      body: png(800, 600, route.request().url().includes("-1") ? [200, 120, 60] : [60, 120, 200]),
    }),
  );
  await page.goto("/de/driver/login");
  const form = page.getByTestId("driver-login-form");
  await form.locator('input[name="username"]').fill(name);
  await form.locator('input[name="pin"]').fill(PIN);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/de\/driver$/);
}

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

const box = async (page: Page, id: string) => {
  await expect(page.getByTestId(id)).toBeVisible();
  const b = await page.getByTestId(id).boundingBox();
  expect(b, id).not.toBeNull();
  return b!;
};

test.describe.configure({ mode: "serial" });

for (const locale of LOCALES) {
  test(`stop detail at 375 px in ${locale}`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await login(page);

    // Stop 1: both photos, notes, delivery hours.
    await page.goto(`/${locale}/driver/stops/${stopIds[0]}`);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.getByTestId("stop-name")).toHaveText(names[0]);
    await expect(page.getByTestId("stop-number")).toHaveText("1");
    await expect(page.getByTestId("stop-address")).toContainText("Hauptstraße 1, 1010 Wien");
    await expect(page.getByTestId("navigate")).toHaveAttribute(
      "href",
      "https://www.google.com/maps/dir/?api=1&destination=48.2,16.37&travelmode=driving",
    );
    await expect(page.getByTestId("navigate-apple")).toHaveCount(0);
    for (const kind of ["store", "parking"]) {
      const img = page.getByTestId(`photo-${kind}`).locator("img");
      await expect(img).toBeVisible();
      await expect
        .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth))
        .toBe(800);
    }
    await expect(page.getByTestId("photo-missing")).toHaveCount(0);
    await expect(page.getByTestId("stop-item")).toHaveCount(2);
    const first = page.getByTestId("stop-item").first();
    if (locale === "de") {
      await expect(first.getByTestId("item-name")).toHaveText("Spaghetti lose");
      await expect(page.getByTestId("notes-lang")).toHaveCount(0);
    } else {
      const suffix = { en: "en", "sr-Latn": "sr", cs: "cs" }[locale as "en" | "sr-Latn" | "cs"];
      await expect(first.getByTestId("item-name")).toHaveText(
        locale === "zh-Hans" ? "意大利面" : `Spaghetti lose (${suffix})`,
      );
      await expect(first.getByTestId("item-name-de")).toHaveText("Spaghetti lose");
      await expect(page.getByTestId("notes-lang")).toHaveText("DE");
    }
    await expect(first.getByTestId("item-quantity")).toContainText(/13/);
    await expect(page.getByTestId("stop-notes")).toContainText("Hintereingang benutzen");
    // The weekday abbreviations and the clock word follow the locale (delivery-hours.ts).
    const hoursText = {
      de: "Mo-Fr 8-11 Uhr",
      en: "Mon-Fri 8-11 h",
      "sr-Latn": "pon-pet 8-11 č",
      cs: "Po-Pá 8-11 hod.",
      "zh-Hans": "周一-周五 8-11 时",
    }[locale];
    await expect(page.getByTestId("stop-hours")).toContainText(hoursText);

    // Driver UI rules.
    const quantity = await first
      .getByTestId("item-quantity")
      .locator("strong")
      .evaluate((el) => {
        const s = getComputedStyle(el);
        return { size: parseFloat(s.fontSize), weight: Number(s.fontWeight) };
      });
    expect(quantity.size).toBeGreaterThanOrEqual(28);
    expect(quantity.weight).toBeGreaterThanOrEqual(700);
    for (const id of ["back", "navigate", "next-stop"]) {
      expect((await box(page, id)).height, id).toBeGreaterThanOrEqual(48);
    }
    // The address text is a span inside a 48 px row; the touch target is the copy button next to it.
    const copy = await page.getByRole("button", { name: /^[^:]+: .*Hauptstraße 1/ }).boundingBox();
    expect(copy!.height, "copy address").toBeGreaterThanOrEqual(48);
    expect(
      await page
        .getByTestId("stop-address")
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
    ).toBeGreaterThanOrEqual(16);
    expect(await noHorizontalScroll(page)).toBe(true);
    await expect(page.getByTestId("prev-stop")).toBeDisabled();
    // The 4:3 frame (a present photo also has a "Replace photo" button below it, NUD-083).
    const frame = (id: string) =>
      box(page, id).then(() => page.getByTestId(id).getByTestId("photo-frame").boundingBox());
    const withPhotos = (await frame("photo-store"))!;
    await page.screenshot({
      path: testInfo.outputPath(`stop-photos-${locale}.png`),
      fullPage: true,
    });

    // Stop 3: no photos at all, no notes: placeholders keep the layout and the page works.
    await page.getByTestId("next-stop").click();
    await expect(page).toHaveURL(new RegExp(`/stops/${stopIds[1]}$`));
    await page.goto(`/${locale}/driver/stops/${stopIds[2]}`);
    await expect(page.getByTestId("stop-name")).toHaveText(names[2]);
    await expect(page.getByTestId("photo-missing")).toHaveCount(2);
    // No delivery hours: the (hidden, kept for the offline comparison) info container is empty.
    await expect(page.getByTestId("stop-info")).toBeEmpty();
    await expect(page.getByTestId("next-stop")).toBeDisabled();
    await expect(page.getByTestId("prev-stop")).toHaveAttribute("href", /\/stops\//);
    const without = (await frame("photo-store"))!;
    expect(Math.round(without.height)).toBe(Math.round(withPhotos.height));
    expect(Math.round(without.width)).toBe(Math.round(withPhotos.width));
    expect(await noHorizontalScroll(page)).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`stop-no-photos-${locale}.png`),
      fullPage: true,
    });
    expect(errors.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
  });
}

test("one photo missing, fullscreen pinch-zoom viewer, copy address, prev / next", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
  await login(page);
  await page.goto(`/de/driver/stops/${stopIds[1]}`);
  await expect(page.getByTestId("photo-store").locator("img")).toBeVisible();
  await expect(page.getByTestId("photo-parking").getByTestId("photo-missing")).toBeVisible();
  // Compare the 4:3 frames (a present photo also has a "Replace photo" button, NUD-083).
  const frame = async (id: string) =>
    (await page.getByTestId(id).getByTestId("photo-frame").boundingBox())!;
  const store = await frame("photo-store");
  const parking = await frame("photo-parking");
  expect(Math.round(parking.height)).toBe(Math.round(store.height));

  // Tap -> fullscreen viewer with zoom controls.
  await page.getByTestId("photo-frame").first().getByRole("button").click();
  const image = page.getByTestId("zoom-image");
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute("data-scale", "1");
  await page.getByRole("button", { name: "Vergrößern", exact: true }).first().click();
  await expect(image).not.toHaveAttribute("data-scale", "1");
  await page.keyboard.press("Escape");
  await expect(image).toHaveCount(0);

  // Tap the copy-address button next to the address: copied to the clipboard.
  await page.getByRole("button", { name: /Hauptstraße 1, 1010 Wien/ }).click();
  await expect(page.getByTestId("address-copied")).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
  if (copied !== null) expect(copied).toBe("Hauptstraße 1, 1010 Wien");

  // Prev / next walk the tour in order (Next keeps visited routes hidden in the DOM: :visible).
  await page.locator('[data-testid="next-stop"]:visible').click();
  await expect(page).toHaveURL(new RegExp(`/stops/${stopIds[2]}$`));
  await page.locator('[data-testid="prev-stop"]:visible').click();
  await expect(page).toHaveURL(new RegExp(`/stops/${stopIds[1]}$`));
  await page.locator('[data-testid="prev-stop"]:visible').click();
  await expect(page).toHaveURL(new RegExp(`/stops/${stopIds[0]}$`));
});

test("Apple Maps option only on iOS, with the pin coordinates", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  });
  const page = await context.newPage();
  await login(page);
  await page.goto(`/de/driver/stops/${stopIds[0]}`);
  await expect(page.getByTestId("navigate")).toBeVisible();
  await expect(page.getByTestId("navigate-apple")).toHaveAttribute(
    "href",
    "https://maps.apple.com/?daddr=48.2,16.37",
  );
  expect((await box(page, "navigate-apple")).height).toBeGreaterThanOrEqual(48);
  expect(await noHorizontalScroll(page)).toBe(true);
  await context.close();
});

test("only the driver's own stops of today open; others see nothing", async ({ page, browser }) => {
  await login(page);
  await page.goto(`/de/driver/stops/does-not-exist-${tag}`);
  await expect(page.getByTestId("stop-detail")).toHaveCount(0);
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const other = await context.newPage();
  await login(other, otherUsername);
  // The page streams (Suspense), so the status is already 200; what matters is that nothing leaks.
  await other.goto(`/de/driver/stops/${stopIds[0]}`);
  await expect(other.getByTestId("stop-detail")).toHaveCount(0);
  await expect(other.locator("body")).not.toContainText(names[0]);
  await expect(other.locator("body")).not.toContainText("Hintereingang");
  await context.close();
});
