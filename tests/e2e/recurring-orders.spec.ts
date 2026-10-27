import { expect, type Page, test } from "@playwright/test";
import { Client } from "pg";

// NUD-149: recurring orders (Dauerbestellungen). Needs the seeded catalog, DATABASE_URL and
// SEED_ADMIN_PASSWORD. The rule starts on a Monday in 2099 and the orders are generated for the
// 14 days after "today", so the spec checks the generated orders through a start date of today.
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "change-me-local-only";

async function loginAdmin(page: Page) {
  await page.goto("/de/login");
  await page.getByLabel("E-Mail").fill("admin@example.com");
  await page.getByLabel("Passwort").fill(adminPassword);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/admin$/);
}

test("recurring order: confirm a rule once, orders appear, pause, archive the customer cancels them", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name.startsWith("mobile"), "admin screen, desktop only");
  test.setTimeout(150_000);
  const tag = `e2er${Date.now() % 1e8}`;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const customerId = `id-${tag}`;
  await client.query(
    `INSERT INTO "Customer" ("id","customerNumber","name","street","postalCode","city","active","updatedAt")
     VALUES ($1,$2,$3,'Hauptstraße 1','1010','Wien',true,now())`,
    [customerId, tag, `Trattoria ${tag}`],
  );
  const count = async (where = "") =>
    Number(
      (
        await client.query(
          `SELECT count(*)::int AS n FROM "Order" WHERE "customerId"=$1 AND "recurringOrderId" IS NOT NULL ${where}`,
          [customerId],
        )
      ).rows[0].n,
    );
  try {
    await loginAdmin(page);
    await page.goto(`/de/admin/customers/${customerId}`);
    await expect(page.getByTestId("recurring-empty")).toBeVisible();

    await page.getByTestId("recurring-new").click();
    // Every day of the week, so the 14-day horizon always contains orders (15 days incl. today).
    for (const day of [1, 2, 3, 4, 5, 6, 7]) {
      await page.getByTestId(`recurring-weekday-${day}`).check();
    }
    await page.getByTestId("recurring-line-product").first().selectOption({ index: 1 });
    await page.getByTestId("recurring-line-quantity").first().fill("2");
    // A missing quantity is explained, nothing is saved.
    await page.getByTestId("recurring-line-quantity").first().fill("1,5");
    await page.getByTestId("recurring-save").click();
    await expect(page.getByTestId("recurring-error")).toHaveAttribute("data-code", "lines");
    await page.getByTestId("recurring-line-quantity").first().fill("2");
    await page.screenshot({ path: testInfo.outputPath("recurring-form.png") });
    await page.getByTestId("recurring-save").click();
    await expect(page.getByTestId("recurring-rule")).toHaveCount(1);
    await expect(page.getByTestId("recurring-state")).toHaveAttribute("data-state", "active");
    await expect(page.getByTestId("recurring-schedule")).toContainText("Jede Woche");
    expect(await count()).toBe(15);
    await expect(page.getByTestId("order-from-recurring").first()).toContainText(
      "aus Dauerbestellung",
    );
    await page.screenshot({ path: testInfo.outputPath("recurring-card.png"), fullPage: true });

    // The order list marks them too.
    await page.goto(`/de/admin/orders`);
    await expect(page.getByTestId("order-from-recurring").first()).toBeVisible();

    // Pause: stays paused, existing orders stay.
    await page.goto(`/de/admin/customers/${customerId}`);
    await page.getByTestId("recurring-pause").click();
    await expect(page.getByTestId("recurring-state")).toHaveAttribute("data-state", "paused");
    expect(await count()).toBe(15);
    await page.getByTestId("recurring-resume").click();
    await expect(page.getByTestId("recurring-state")).toHaveAttribute("data-state", "active");
    expect(await count()).toBe(15);

    // Archiving the customer cancels the open orders and pauses the rule.
    await page.getByTestId("customer-archive").click();
    await expect(page.getByTestId("archive-rules-note")).toBeVisible();
    await expect(page.getByTestId("archive-upcoming-warning")).toBeVisible();
    await page.getByTestId("customer-archive-confirm").click();
    await expect(page.getByTestId("flag-archived")).toBeVisible();
    await expect(page.getByTestId("recurring-state")).toHaveAttribute(
      "data-state",
      "customer_inactive",
    );
    expect(await count(`AND "status"='CANCELLED'`)).toBe(15);
    expect(await count(`AND "status"<>'CANCELLED'`)).toBe(0);

    // Restoring resumes the rule; the cancelled orders stay cancelled.
    await page.getByTestId("customer-restore").click();
    await expect(page.getByTestId("recurring-state")).toHaveAttribute("data-state", "active");
    expect(await count(`AND "status"='CANCELLED'`)).toBe(15);
    expect(await count()).toBe(15);
  } finally {
    await client.end();
  }
});
