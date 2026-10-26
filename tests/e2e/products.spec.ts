import { expect, type Page, test } from "@playwright/test";
import { Client } from "pg";

// Needs a seeded database (`pnpm db:seed`), DATABASE_URL and SEED_ADMIN_PASSWORD in the environment.
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "change-me-local-only";

async function loginAdmin(page: Page) {
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

const skuOrder = (page: Page) =>
  page
    .getByTestId("product-row")
    .evaluateAll((rows) => rows.map((r) => r.getAttribute("data-sku")));

test("product catalog: machine-translated names, auto markers, required zh-Hans, reorder, deactivate", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const tag = `E2E${testInfo.project.name.slice(0, 1).toUpperCase()}${Date.now() % 1e8}`;
  const skuA = `${tag}A`;
  const skuB = `${tag}B`;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await loginAdmin(page);
    await page.goto("/de/admin/products");
    await expect(page.getByTestId("section-title")).toHaveText("Produkte");
    await expect(page.getByTestId("product-row").first()).toBeVisible(); // seeded products

    // New product: zh-Hans required, en / sr-Latn / cs start empty and "auto".
    await page.getByTestId("new-product").click();
    await expect(page).toHaveURL(/\/admin\/products\/new$/);
    await page.getByTestId("product-sku").fill(skuA);
    // Weight per unit is required and must be > 0 (NUD-138).
    await page.getByTestId("product-weight").fill("0");
    await page.getByTestId("product-name-de").fill(`Schraubennudeln ${tag}`);
    await page.getByTestId("product-name-hans").fill("螺旋意面");
    await page.getByTestId("product-save").click();
    await expect(page.getByTestId("form-error")).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/products\/new$/);
    await page.getByTestId("product-weight").fill("2,5");
    await page.getByTestId("product-name-hans").fill("");
    await page.getByTestId("product-name-de").fill(`Schraubennudeln ${tag}`);
    await page.getByTestId("product-save").click();
    await expect(page.getByTestId("hans-required")).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/products\/new$/);

    // English, Serbian and Czech start empty and "auto": translated from German on save.
    await page.getByTestId("product-name-hans").fill("螺旋意面");
    await expect(page.getByTestId("product-name-en")).toHaveValue("");
    await expect(page.getByTestId("auto-badge")).toHaveCount(3);
    await expect(page.getByTestId("product-name-sr")).toHaveAttribute("lang", "sr-Latn");

    // Editing a field removes its marker; the other two stay automatic.
    await page.getByTestId("product-name-sr").fill("Zavrnute nudle");
    await expect(page.getByTestId("auto-badge")).toHaveCount(2);
    await page.getByTestId("product-name-hans").fill("螺旋意面 3公斤");
    await expect(noHorizontalScroll(page)).resolves.toBe(true);

    await page.getByTestId("product-save").click();
    await expect(page).toHaveURL(/\/admin\/products$/);
    const rowA = page.locator(`[data-testid="product-row"][data-sku="${skuA}"]`);
    await expect(rowA).toContainText("螺旋意面 3公斤");
    await expect(rowA.getByTestId("product-weight-cell")).toContainText("2,5 kg");
    await expect(rowA.getByTestId("status-active")).toBeVisible();
    const stored = (
      await client.query(`SELECT "name","unit","active" FROM "Product" WHERE "sku"=$1`, [skuA])
    ).rows[0] as { name: Record<string, unknown>; unit: string; active: boolean };
    expect(stored.name).toMatchObject({
      "zh-Hans": "螺旋意面 3公斤",
      de: `Schraubennudeln ${tag}`,
      "sr-Latn": "Zavrnute nudle",
      meta: { machine: { en: true, cs: true } },
    });
    expect(stored.name["en"]).toEqual(expect.any(String));
    expect(stored.name["cs"]).toEqual(expect.any(String));
    expect((stored.name["meta"] as { machine: object }).machine).not.toHaveProperty("sr-Latn");

    // Duplicate SKU (case-insensitive) is rejected with a localized message.
    await page.getByTestId("new-product").click();
    await page.getByTestId("product-sku").fill(skuA.toLowerCase());
    await page.getByTestId("product-weight").fill("3");
    await page.getByTestId("product-name-de").fill("Doppelt");
    await page.getByTestId("product-name-hans").fill("重复");
    await page.getByTestId("product-save").click();
    await expect(page.getByTestId("sku-taken")).toBeVisible();

    // A second product, then reorder with the up/down buttons.
    await page.getByTestId("product-sku").fill(skuB);
    await page.getByTestId("product-weight").fill("10");
    await page.getByTestId("product-save").click();
    await expect(page).toHaveURL(/\/admin\/products$/);
    const rowB = page.locator(`[data-testid="product-row"][data-sku="${skuB}"]`);
    await expect(rowB).toBeVisible();
    // Reordering swaps neighbours in one shared list, so only one project asserts positions
    // (the desktop and mobile projects run in parallel against the same database).
    if (testInfo.project.name === "desktop") {
      const before = (await skuOrder(page)).indexOf(skuB);
      await rowB.getByTestId("move-up").click();
      await expect.poll(async () => (await skuOrder(page)).indexOf(skuB)).toBe(before - 1);
      await page.reload();
      expect((await skuOrder(page)).indexOf(skuB)).toBe(before - 1);
      await rowB.getByTestId("move-down").click();
      await expect.poll(async () => (await skuOrder(page)).indexOf(skuB)).toBe(before);
    }

    // Edit keeps the auto marker of a machine-derived name; reactivation/deactivation is soft.
    await rowA.getByRole("button").last().click(); // row menu (portal)
    await page.getByTestId("product-edit").click();
    await expect(page).toHaveURL(/\/edit$/);
    await expect(page.locator('[data-testid="product-name-hans"]:visible')).toHaveValue(
      "螺旋意面 3公斤",
    );
    await expect(page.locator('[data-testid="auto-badge"]:visible')).toHaveCount(2); // en, cs auto; sr by hand
    await expect(page.locator('[data-testid="product-name-sr"]:visible')).toHaveValue(
      "Zavrnute nudle",
    );
    await page.locator('[data-testid="rederive-sr"]:visible').click();
    await expect(page.locator('[data-testid="auto-badge"]:visible')).toHaveCount(3);
    await page.locator('[data-testid="product-save"]:visible').click();
    await expect(page).toHaveURL(/\/admin\/products$/);

    await rowA.getByRole("button").last().click(); // row menu (portal)
    await page.getByTestId("product-deactivate").click();
    await page.getByTestId("confirm-submit").click();
    await expect(rowA.getByTestId("status-inactive")).toBeVisible();
    await page.reload();
    await expect(rowA.getByTestId("status-inactive")).toBeVisible();
    const inactive = await client.query(`SELECT "active" FROM "Product" WHERE "sku"=$1`, [skuA]);
    expect(inactive.rows[0]).toEqual({ active: false });
    await expect(noHorizontalScroll(page)).resolves.toBe(true);
    await rowA.getByRole("button").last().click(); // row menu (portal)
    await page.getByTestId("product-activate").click();
    await expect(rowA.getByTestId("status-active")).toBeVisible();
  } finally {
    await client.query(`DELETE FROM "Product" WHERE "sku" LIKE $1`, [`${tag}%`]);
    await client.end();
  }
});

test("product pages require an admin session", async ({ page }) => {
  await page.goto("/de/admin/products");
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/de/admin/products/new");
  await expect(page).toHaveURL(/\/login/);
});
