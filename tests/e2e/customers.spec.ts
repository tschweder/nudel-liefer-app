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

async function db() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  return client;
}

test("customer list: accent-insensitive search, photo filter, new-customer link", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const tag = `e2e${Date.now()}${Math.floor(Math.random() * 1e4)}`;
  const client = await db();
  const insert = async (suffix: string, name: string, pinConfirmed: boolean) =>
    (
      await client.query<{ id: string }>(
        `INSERT INTO "Customer" ("id","customerNumber","name","street","postalCode","city","pinConfirmed","updatedAt")
         VALUES ($1,$2,$3,'Hauptstraße 1','1010','Wien',$4,now()) RETURNING "id"`,
        [`id-${tag}-${suffix}`, `${tag}-${suffix}`, name, pinConfirmed],
      )
    ).rows[0]!.id;
  try {
    const admin = (await client.query(`SELECT "id" FROM "User" WHERE "role"='ADMIN' LIMIT 1`))
      .rows[0] as { id: string };
    await insert("A", `Café Müller ${tag}`, false);
    const b = await insert("B", `Pizzeria Bella ${tag}`, true);
    for (const kind of ["STORE", "PARKING"]) {
      await client.query(
        `INSERT INTO "Photo" ("id","customerId","kind","storageKey","width","height","bytes","uploadedById","isCurrent")
         VALUES ($1,$2,$3::"PhotoKind",$4,1,1,1,$5,true)`,
        [`ph-${tag}-${kind}`, b, kind, `e2e/${tag}/${kind}`, admin.id],
      );
    }

    await loginAdmin(page);
    await page.goto("/de/admin/customers");
    await expect(page.getByTestId("section-title")).toHaveText("Kunden");

    const rows = page.getByTestId("customer-row");
    await page.getByTestId("customer-search").fill(`cafe muller ${tag}`);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(`Café Müller ${tag}`);
    await expect(rows.first().getByTestId("flag-photos-missing")).toBeVisible();
    await expect(rows.first().getByTestId("flag-pin-unconfirmed")).toBeVisible();
    await expect(page).toHaveURL(/q=cafe(\+|%20)muller/);

    await page.getByTestId("customer-search").fill(tag);
    await expect(rows).toHaveCount(2);

    // Photo filter: only the customer without current STORE + PARKING photos.
    await page.getByTestId("filter-photos-missing").check();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Café Müller");
    await page.getByTestId("filter-photos-missing").uncheck();
    await expect(rows).toHaveCount(2);

    await page.getByTestId("filter-pin-unconfirmed").check();
    await expect(rows).toHaveCount(1);
    await page.getByTestId("filter-pin-unconfirmed").uncheck();

    await page.getByTestId("customer-search").fill(`${tag} gibtesnicht`);
    await expect(page.getByTestId("empty-state")).toBeVisible();
    await page.getByTestId("reset-filters").click();
    await expect(page).toHaveURL(/\/de\/admin\/customers$/);

    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);

    await page.getByTestId("new-customer").click();
    await expect(page).toHaveURL(/\/de\/admin\/customers\/new$/);
    await expect(page.getByRole("heading", { name: "Neuer Kunde" })).toBeVisible();
  } finally {
    await client.query(`DELETE FROM "Photo" WHERE "storageKey" LIKE $1`, [`e2e/${tag}/%`]);
    await client.query(`DELETE FROM "Customer" WHERE "customerNumber" LIKE $1`, [`${tag}-%`]);
    await client.end();
  }
});
