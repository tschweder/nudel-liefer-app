import { deflateSync } from "node:zlib";

import { expect, type Page, test } from "@playwright/test";
import { Client } from "pg";

// Needs a seeded database, DATABASE_URL, SEED_ADMIN_PASSWORD and a real S3-compatible storage
// (MinIO from docker-compose, or the s3rver emulator) configured via S3_* for the app AND visible
// in this process: the browser PUTs the photo to the presigned URL and reads it back signed.
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "change-me-local-only";

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

async function loginAdmin(page: Page) {
  await page.route(/\/\d+\/\d+\/\d+\.png/, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: TILE }),
  );
  await page.goto("/de/login");
  await page.getByLabel("E-Mail").fill("admin@example.com");
  await page.getByLabel("Passwort").fill(adminPassword);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/admin$/);
}

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth <= root.clientWidth;
  });

test("customer photos: upload, flag, reload, replace with history, fullscreen", async ({
  page,
}, testInfo) => {
  test.skip(!process.env.S3_BUCKET, "needs S3_* (MinIO / s3rver) for real uploads");
  test.setTimeout(180_000);
  const tag = `e2ep${testInfo.project.name}${Date.now()}${Math.floor(Math.random() * 1e4)}`;
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  let customerId = "";
  try {
    customerId = (
      await db.query<{ id: string }>(
        `INSERT INTO "Customer" ("id","customerNumber","name","street","postalCode","city","updatedAt")
         VALUES ($1,$2,$3,'Teststraße 1','1010','Wien',now()) RETURNING "id"`,
        [`c${tag}`, tag, `Photo Test ${tag}`],
      )
    ).rows[0].id;

    await loginAdmin(page);
    await page.goto(`/de/admin/customers/${customerId}`);
    const store = page.getByTestId("photo-slot-store");
    const parking = page.getByTestId("photo-slot-parking");
    await expect(store).toContainText("Geschäft / Eingang");
    await expect(parking).toContainText("Parken / Entladen");
    await expect(page.getByTestId("flag-photos-missing")).toBeVisible();
    await expect(store.getByRole("button", { name: /Bild vergrößern/ })).toHaveCount(0);

    // Upload STORE: flag stays (parking is still missing).
    await store.getByTestId("image-uploader-input").setInputFiles({
      name: "shop.png",
      mimeType: "image/png",
      buffer: png(900, 600, [200, 120, 60]),
    });
    const storeThumb = store.getByRole("button", { name: /Bild vergrößern/ });
    await expect(storeThumb).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("flag-photos-missing")).toBeVisible();

    // Upload PARKING: flag disappears.
    await parking.getByTestId("image-uploader-input").setInputFiles({
      name: "parking.png",
      mimeType: "image/png",
      buffer: png(800, 800, [60, 160, 220]),
    });
    await expect(parking.getByRole("button", { name: /Bild vergrößern/ })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("flag-photos-missing")).toHaveCount(0);

    // Reload: both photos are served through signed URLs and actually decode.
    await page.reload();
    await expect(page.getByTestId("flag-photos-missing")).toHaveCount(0);
    for (const slot of [store, parking]) {
      const img = slot.locator("img");
      await expect(img).toBeVisible();
      await expect
        .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth))
        .toBeGreaterThan(0);
    }
    const before = await store.locator("img").getAttribute("src");
    expect(before).toMatch(/X-Amz-Signature=/);
    expect(await noHorizontalScroll(page)).toBe(true);
    await page.screenshot({
      path: `test-results/customer-photos-${testInfo.project.name}.png`,
      fullPage: true,
    });

    // Replace STORE: new photo is current, the old row stays as history.
    await store.getByTestId("photo-replace").click();
    await store.getByTestId("image-uploader-input").setInputFiles({
      name: "shop2.png",
      mimeType: "image/png",
      buffer: png(700, 500, [20, 200, 20]),
    });
    await expect(store.getByTestId("photo-replace")).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () => store.locator("img").getAttribute("src"), { timeout: 30_000 })
      .not.toBe(before);
    const rows = (
      await db.query<{ isCurrent: boolean; storageKey: string }>(
        `SELECT "isCurrent","storageKey" FROM "Photo" WHERE "customerId"=$1 AND "kind"='STORE' ORDER BY "createdAt"`,
        [customerId],
      )
    ).rows;
    expect(rows.map((r) => r.isCurrent)).toEqual([false, true]);
    expect(rows[0].storageKey).toMatch(/^customers\/.+\.jpg$/);
    await expect(page.getByTestId("flag-photos-missing")).toHaveCount(0);

    // Fullscreen view.
    await store.getByRole("button", { name: /Bild vergrößern/ }).click();
    const full = page.getByTestId("zoom-image");
    await expect(full).toBeVisible();
    await expect
      .poll(() => full.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth))
      .toBeGreaterThan(0);
    await page.keyboard.press("Escape");
    await expect(full).toHaveCount(0);
  } finally {
    if (customerId) {
      await db.query(`DELETE FROM "Photo" WHERE "customerId"=$1`, [customerId]);
      await db.query(`DELETE FROM "Customer" WHERE "id"=$1`, [customerId]);
    }
    await db.end();
  }
});

test("customer photos: anonymous visitors are redirected, nothing is exposed", async ({ page }) => {
  await page.goto("/de/admin/customers/some-id");
  await expect(page).toHaveURL(/\/login/);
});
