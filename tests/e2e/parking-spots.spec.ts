import { expect, type Page, test } from "@playwright/test";
import { Client } from "pg";

// NUD-125: the office manages a customer's Parkplätze on the detail page. Needs a seeded database
// (`pnpm db:seed`), DATABASE_URL and SEED_ADMIN_PASSWORD in the environment.
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "change-me-local-only";

// 1x1 transparent PNG: the test never depends on a live tile server.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

async function loginAdmin(page: Page) {
  await page.goto("/de/login");
  await page.getByLabel("E-Mail").fill("admin@example.com");
  await page.getByLabel("Passwort").fill(adminPassword);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/admin$/);
}

test("customer detail: add, edit, reorder and remove parking spots", async ({ page }) => {
  test.setTimeout(150_000);
  await page.route(/\/\d+\/\d+\/\d+\.png/, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: PNG }),
  );
  const tag = `pk${Date.now()}${Math.floor(Math.random() * 1e4)}`;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const customerId = `id-${tag}`;
  try {
    await client.query(
      `INSERT INTO "Customer" ("id","customerNumber","name","street","postalCode","city","lat","lng","updatedAt")
       VALUES ($1,$2,$3,'Hauptstraße 1','1010','Wien',48.2082,16.3738,now())`,
      [customerId, tag, `Parkplatz-Test ${tag}`],
    );

    await loginAdmin(page);
    await page.goto(`/de/admin/customers/${customerId}`);
    const section = page.getByTestId("parking-spots");
    await expect(section.getByTestId("parking-empty")).toContainText("Lieferung zur Adresse");

    // 1st spot: click on the map -> coordinates appear -> save.
    await section.getByTestId("parking-add").click();
    const dialog = page.getByTestId("parking-dialog");
    await dialog.getByTestId("parking-save").click();
    await expect(dialog.getByTestId("parking-point-missing")).toBeVisible();
    await dialog.getByTestId("parking-label").fill("Hof");
    await dialog.getByTestId("parking-note-input").fill("Einfahrt links");
    await dialog.locator(".leaflet-container").click();
    await expect(dialog.getByTestId("pin-lat")).not.toHaveValue("");
    await dialog.getByTestId("parking-save").click();
    await expect(dialog).toBeHidden();
    const rows = section.getByTestId("parking-row");
    await expect(rows).toHaveCount(1);
    await expect(rows.first().getByTestId("parking-name")).toHaveText("Hof");
    await expect(rows.first().getByTestId("parking-default")).toHaveText("Standard");
    await expect(rows.first().getByTestId("parking-note")).toHaveText("Einfahrt links");

    // 2nd spot typed in as coordinates (keyboard alternative), without a name.
    await section.getByTestId("parking-add").click();
    await dialog.getByTestId("pin-lat").fill("48.21");
    await dialog.getByTestId("pin-lng").fill("16.37");
    await dialog.getByTestId("parking-save").click();
    await expect(dialog).toBeHidden();
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(1).getByTestId("parking-name")).toHaveText("Parkplatz 2");
    await expect(rows.nth(1).getByTestId("parking-default")).toHaveCount(0);

    // Reorder: the second becomes the default.
    await rows.nth(1).getByTestId("parking-up").click();
    await expect(rows.first().getByTestId("parking-default")).toBeVisible();
    await expect(rows.nth(1).getByTestId("parking-name")).toHaveText("Hof");

    // Edit the name of the first row.
    await rows.first().getByTestId("parking-edit").click();
    await dialog.getByTestId("parking-label").fill("Gasse hinten");
    await dialog.getByTestId("parking-save").click();
    await expect(dialog).toBeHidden();
    await expect(rows.first().getByTestId("parking-name")).toHaveText("Gasse hinten");

    // Remove (soft delete) with confirmation.
    await rows.first().getByTestId("parking-remove").click();
    await page.getByTestId("parking-remove-confirm").click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first().getByTestId("parking-name")).toHaveText("Hof");
    await expect(rows.first().getByTestId("parking-default")).toBeVisible();

    const spots = await client.query(
      `SELECT "label","active","sortOrder" FROM "ParkingSpot" WHERE "customerId"=$1 ORDER BY "createdAt"`,
      [customerId],
    );
    expect(spots.rows.map((r) => [r.label, r.active])).toEqual([
      ["Hof", true],
      ["Gasse hinten", false],
    ]);
    const audit = await client.query(
      `SELECT "action" FROM "AuditLog" WHERE "entity"='Customer' AND "entityId"=$1 AND "action" LIKE 'parking.%' ORDER BY "createdAt"`,
      [customerId],
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      "parking.create",
      "parking.create",
      "parking.reorder",
      "parking.update",
      "parking.deactivate",
    ]);

    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
  } finally {
    await client.query(`DELETE FROM "ParkingSpot" WHERE "customerId"=$1`, [customerId]);
    await client.query(`DELETE FROM "Customer" WHERE "id"=$1`, [customerId]);
    await client.end();
  }
});
