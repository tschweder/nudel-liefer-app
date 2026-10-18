import { expect, type Page, test } from "@playwright/test";
import { Client } from "pg";

import { customerImportRows, toCsv } from "../../src/domain/testing/import-fixtures";

// Needs a seeded database (`pnpm db:seed`), DATABASE_URL and SEED_ADMIN_PASSWORD in the environment.
// Geocoding uses the Fake geocoder (no ORS_API_KEY), tiles are stubbed.
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "change-me-local-only";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

async function loginAdmin(page: Page) {
  await page.route(/\/\d+\/\d+\/\d+\.png/, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: PNG }),
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
    if (root.scrollWidth <= root.clientWidth) return true;
    const wide = [...document.querySelectorAll("body *")]
      .filter((el) => el.getBoundingClientRect().right > root.clientWidth + 1)
      .slice(0, 6)
      .map((el) => `${el.tagName}.${String(el.className).slice(0, 60)}`);
    throw new Error(`overflow: ${wide.join(" | ")}`);
  });

// A prefix that sorts before every other customer number, so the pin review queue (ordered by
// number) starts with this test's customers.
const newPrefix = () => `00-IMP${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}-`;

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}

const removeCustomers = (prefix: string) =>
  withDb((db) => db.query(`DELETE FROM "Customer" WHERE "customerNumber" LIKE $1`, [`${prefix}%`]));

const csvFile = (rows: string[][], name = "kunden.csv") => ({
  name,
  mimeType: "text/csv",
  buffer: Buffer.from(toCsv(rows)),
});

const visible = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`);

async function uploadAndMap(page: Page, file: ReturnType<typeof csvFile>) {
  await visible(page, "import-file").setInputFiles(file);
  await expect(visible(page, "mapping-table")).toBeVisible();
  await expect(visible(page, "map-customerNumber")).toHaveValue("0");
  await visible(page, "mapping-next").click();
  await expect(visible(page, "preview-summary")).toBeVisible();
}

test("customer import: 150-row file with 3 invalid rows, re-import, address change, geocoding, pin review", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "long flow runs at 1280 px");
  test.setTimeout(240_000);
  const prefix = newPrefix();
  const rows = customerImportRows(prefix);
  try {
    await loginAdmin(page);
    await page.goto("/de/admin/customers");
    await visible(page, "import-customers").click();
    await expect(page).toHaveURL(/\/de\/admin\/customers\/import$/);
    await expect(page.getByRole("heading", { name: "Kunden importieren" })).toBeVisible();

    // 1. Upload + mapping (German headers are recognised)
    await visible(page, "import-file").setInputFiles(csvFile(rows));
    await expect(visible(page, "mapping-intro")).toContainText("150 Datenzeilen");
    for (const [field, column] of [
      ["customerNumber", "0"],
      ["name", "1"],
      ["street", "2"],
      ["postalCode", "3"],
      ["city", "4"],
      ["country", "5"],
      ["deliveryHoursInfo", "6"],
      ["notes", "7"],
    ] as const) {
      await expect(visible(page, `map-${field}`)).toHaveValue(column);
    }
    expect(await noHorizontalScroll(page)).toBe(true);
    await page.screenshot({ path: "test-results/customer-import-mapping.png", fullPage: true });

    // A required field without a column blocks the next step.
    await visible(page, "map-city").selectOption("");
    await expect(visible(page, "mapping-problems")).toContainText("Ort");
    await expect(visible(page, "mapping-next")).toBeDisabled();
    await visible(page, "map-city").selectOption("4");
    await expect(visible(page, "mapping-next")).toBeEnabled();

    // 2. Preview with row-level errors
    await visible(page, "mapping-next").click();
    await expect(visible(page, "preview-create")).toHaveText("147");
    await expect(visible(page, "preview-error")).toHaveText("3");
    await expect(visible(page, "preview-update")).toHaveText("0");
    const errorRows = visible(page, "preview-row");
    await expect(errorRows).toHaveCount(3); // filter defaults to the faulty rows
    await expect(errorRows.nth(0)).toContainText("PLZ fehlt");
    await expect(errorRows.nth(0)).toContainText("21");
    await expect(errorRows.nth(1)).toContainText("Formel");
    await expect(errorRows.nth(2)).toContainText("Land nicht erkannt");
    expect(await noHorizontalScroll(page)).toBe(true);
    await page.screenshot({ path: "test-results/customer-import-preview.png", fullPage: true });
    await visible(page, "preview-filter").selectOption("all");
    await expect(visible(page, "preview-row")).toHaveCount(150);

    // 3. Import
    await visible(page, "import-commit").click();
    await expect(visible(page, "result-created")).toHaveText("147");
    await expect(visible(page, "result-failed")).toHaveText("3");
    await expect(visible(page, "failed-row")).toHaveCount(3);
    const counts = await withDb((db) =>
      db.query(
        `SELECT count(*)::int AS n, count(*) FILTER (WHERE "pinConfirmed")::int AS confirmed,
                count(*) FILTER (WHERE lat IS NOT NULL)::int AS pinned
           FROM "Customer" WHERE "customerNumber" LIKE $1`,
        [`${prefix}%`],
      ),
    );
    expect(counts.rows[0]).toEqual({ n: 147, confirmed: 0, pinned: 0 });

    // 4. Batch geocoding with progress (Fake geocoder)
    await visible(page, "geocode-start").click();
    await expect(visible(page, "geocode-finished")).toBeVisible({ timeout: 120_000 });
    const bar = visible(page, "geocode-progress");
    await expect(bar).toHaveAttribute(
      "aria-valuenow",
      (await bar.getAttribute("aria-valuemax")) ?? "",
    );
    await expect(visible(page, "geocode-status")).toContainText("von");
    const geocoded = await withDb((db) =>
      db.query(
        `SELECT count(*) FILTER (WHERE lat IS NOT NULL)::int AS pinned,
                count(*) FILTER (WHERE "pinConfirmed")::int AS confirmed
           FROM "Customer" WHERE "customerNumber" LIKE $1`,
        [`${prefix}%`],
      ),
    );
    expect(geocoded.rows[0]).toEqual({ pinned: 147, confirmed: 0 });
    expect(await noHorizontalScroll(page)).toBe(true);
    await page.screenshot({ path: "test-results/customer-import-result.png", fullPage: true });

    // 5. Re-import of the same file: nothing new, nothing duplicated
    await visible(page, "import-again").click();
    await uploadAndMap(page, csvFile(rows));
    await expect(visible(page, "preview-create")).toHaveText("0");
    await expect(visible(page, "preview-update")).toHaveText("0");
    await expect(visible(page, "preview-unchanged")).toHaveText("147");
    await expect(visible(page, "preview-error")).toHaveText("3");
    await expect(visible(page, "import-commit")).toBeDisabled();

    // 6. Changed address: updates instead of duplicates, the pin is dropped
    const changed = rows.map((r) => [...r]);
    changed[1]![2] = "Neugasse 99";
    changed[2]![2] = "Neugasse 100";
    changed[3]![1] = "Pizzeria Umbenannt"; // name only: the pin stays
    await page.goto("/de/admin/customers/import");
    await uploadAndMap(page, csvFile(changed));
    await expect(visible(page, "preview-update")).toHaveText("3");
    await expect(visible(page, "preview-unchanged")).toHaveText("144");
    await expect(visible(page, "preview-pins-reset")).toContainText("2 Kunden");
    await visible(page, "import-commit").click();
    await expect(visible(page, "result-updated")).toHaveText("3");
    await expect(visible(page, "result-created")).toHaveText("0");
    const after = await withDb((db) =>
      db.query(
        `SELECT "customerNumber", street, name, lat, "pinConfirmed" FROM "Customer"
          WHERE "customerNumber" LIKE $1 ORDER BY "customerNumber" LIMIT 4`,
        [`${prefix}%`],
      ),
    );
    expect(after.rows.map((r) => [r.street, r.lat === null])).toEqual([
      ["Neugasse 99", true],
      ["Neugasse 100", true],
      ["Lindengasse 3", false],
      ["Marktplatz 4", false],
    ]);
    expect(after.rows[2].name).toBe("Pizzeria Umbenannt");
    const total = await withDb((db) =>
      db.query(`SELECT count(*)::int AS n FROM "Customer" WHERE "customerNumber" LIKE $1`, [
        `${prefix}%`,
      ]),
    );
    expect(total.rows[0].n).toBe(147);

    // 7. Pin review queue: confirm, drag, skip. The two customers without a pin come first.
    await visible(page, "review-link").click();
    await expect(page).toHaveURL(/\/import\/review$/);
    const position = visible(page, "review-position");
    await expect(position).toContainText("Kunde 1 von");
    await expect(visible(page, "review-name")).toContainText("Gasthaus Zum Löwen 1");
    // No pin yet: the hint says so, confirming needs a pin.
    await expect(visible(page, "review-hint")).toContainText("noch keinen Pin");
    await expect(visible(page, "review-confirm")).toBeDisabled();
    await visible(page, "review-find").click();
    await expect(visible(page, "review-candidate")).toHaveCount(1);
    await visible(page, "review-candidate").click();
    await expect(page.getByTestId("pin-picker").locator(".leaflet-marker-icon")).toHaveCount(1);
    await expect(visible(page, "review-confirm")).toBeEnabled();
    await page.screenshot({ path: "test-results/customer-import-review.png", fullPage: true });
    await visible(page, "review-confirm").click();
    await expect(position).toContainText("Kunde 2 von");
    await expect(visible(page, "review-name")).toContainText("Trattoria Bella Vista 2");

    // Skip the second one; the third one is moved by typing coordinates, then confirmed.
    await visible(page, "review-skip").click();
    await expect(position).toContainText("Kunde 3 von");
    await visible(page, "pin-lat").fill("48.2");
    await visible(page, "pin-lng").fill("16.4");
    await visible(page, "review-confirm").click();
    await expect(position).toContainText("Kunde 4 von");

    // The next one (geocoded by the batch) is dragged on the map, then confirmed.
    const marker = page.getByTestId("pin-picker").locator(".leaflet-marker-icon");
    await expect(marker).toHaveCount(1);
    const latBefore = await visible(page, "pin-lat").inputValue();
    const box = (await marker.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 8 });
    await page.mouse.up();
    await expect(visible(page, "pin-lat")).not.toHaveValue(latBefore);
    const dragged = {
      lat: Number(await visible(page, "pin-lat").inputValue()),
      lng: Number(await visible(page, "pin-lng").inputValue()),
    };
    await visible(page, "review-confirm").click();
    await expect(position).toContainText("Kunde 5 von");

    const reviewed = await withDb((db) =>
      db.query(
        `SELECT "customerNumber", lat, lng, "pinConfirmed" FROM "Customer"
          WHERE "customerNumber" LIKE $1 ORDER BY "customerNumber" LIMIT 5`,
        [`${prefix}%`],
      ),
    );
    expect(reviewed.rows.map((r) => r.pinConfirmed)).toEqual([true, false, true, true, false]);
    expect(reviewed.rows[2]).toMatchObject({ lat: 48.2, lng: 16.4 });
    expect(reviewed.rows[3]).toMatchObject(dragged);
    expect(await noHorizontalScroll(page)).toBe(true);
  } finally {
    await removeCustomers(prefix);
  }
});

test("customer import: review queue to the end, skipped ones again, edited customer is refused", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "runs at 1280 px");
  test.setTimeout(180_000);
  const prefix = newPrefix();
  const rows = [customerImportRows(prefix)[0]!, ...customerImportRows(prefix).slice(1, 4)];
  try {
    await loginAdmin(page);
    await page.goto("/de/admin/customers/import");
    await uploadAndMap(page, csvFile(rows));
    await expect(visible(page, "preview-create")).toHaveText("3");
    await visible(page, "import-commit").click();
    await expect(visible(page, "result-created")).toHaveText("3");
    await visible(page, "geocode-start").click();
    await expect(visible(page, "geocode-finished")).toBeVisible({ timeout: 60_000 });

    await visible(page, "review-link").click();
    const position = visible(page, "review-position");
    await expect(visible(page, "review-name")).toContainText("Gasthaus Zum Löwen 1");

    // Somebody edits customer 1 while the queue is open: confirming it is refused.
    await withDb((db) =>
      db.query(
        `UPDATE "Customer" SET street = 'Anders 1', "updatedAt" = now() WHERE "customerNumber" = $1`,
        [`${prefix}0001`],
      ),
    );
    await visible(page, "review-confirm").click();
    await expect(visible(page, "review-error")).toContainText("inzwischen geändert");
    await visible(page, "review-skip").click();

    await expect(position).toContainText("Kunde 2 von");
    await visible(page, "review-confirm").click();
    await expect(position).toContainText("Kunde 3 von");
    await visible(page, "review-confirm").click();

    // End of the queue (other specs' unconfirmed customers sort after ours).
    for (let i = 0; i < 50; i += 1) {
      if (await visible(page, "review-done").count()) break;
      await visible(page, "review-skip").click();
    }
    await expect(visible(page, "review-done")).toBeVisible();
    await expect(visible(page, "review-summary")).toContainText("2 bestätigt");

    // Review the skipped ones again: our customer 1 (now with its new address) is among them.
    await visible(page, "review-again").click();
    await expect(position).toContainText("Kunde 1 von");
  } finally {
    await removeCustomers(prefix);
  }
});

test("customer import: only admins may use the upload endpoint", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "API check runs once");
  const response = await request.post("/api/admin/customers/import/parse", {
    multipart: { file: { name: "x.csv", mimeType: "text/csv", buffer: Buffer.from("a;b\n1;2") } },
  });
  expect(response.status()).toBe(401);
  expect(await response.json()).toEqual({ error: "UNAUTHENTICATED" });
});

test("customer import: errors for bad files, mobile layout has no horizontal scroll", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile layout check");
  test.setTimeout(120_000);
  const prefix = newPrefix();
  await loginAdmin(page);
  await page.goto("/de/admin/customers/import");
  await expect(visible(page, "import-file")).toBeEnabled();
  await visible(page, "import-file").setInputFiles({
    name: "kaputt.csv",
    mimeType: "text/csv",
    buffer: Buffer.from('a;b\n"offen;1'),
  });
  await expect(visible(page, "import-error")).toContainText("beschädigt");
  await expect(visible(page, "import-file")).toBeEnabled();
  await visible(page, "import-file").setInputFiles({
    name: "leer.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("nur;eine;kopfzeile"),
  });
  await expect(visible(page, "import-error")).toContainText("keine Daten");

  const small = [customerImportRows(prefix)[0]!, ...customerImportRows(prefix).slice(1, 6)];
  await expect(visible(page, "import-file")).toBeEnabled();
  await visible(page, "import-file").setInputFiles(csvFile(small));
  await expect(visible(page, "mapping-table")).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);
  await visible(page, "mapping-next").click();
  await expect(visible(page, "preview-summary")).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);
});
