import { expect, test } from "@playwright/test";

// Needs a seeded database (`pnpm db:seed`) and SEED_ADMIN_PASSWORD in the environment.
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "change-me-local-only";

test("anonymous visitors are sent to the login pages with a return URL", async ({ page }) => {
  await page.goto("/de/admin");
  await expect(page).toHaveURL(/\/de\/login\?callbackUrl=%2Fde%2Fadmin$/);
  await page.goto("/zh-Hans/driver");
  await expect(page).toHaveURL(/\/zh-Hans\/driver\/login/);
});

test("admin logs in and lands on the dashboard", async ({ page }) => {
  await page.goto("/de/login");
  await page.getByLabel("E-Mail").fill("admin@example.com");
  await page.getByLabel("Passwort").fill(adminPassword);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/de\/admin$/);
  await expect(page.getByTestId("admin-title")).toBeVisible();
});

test("driver logs in and lands on the driver home in his own locale", async ({ page }) => {
  await page.goto("/de/driver/login");
  await page.getByTestId("driver-login-form").locator('input[name="username"]').fill("driver-hk");
  await page.getByTestId("driver-login-form").locator('input[name="pin"]').fill("123456");
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/zh-Hant-HK\/driver$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hant-HK");
  // a driver cannot open admin pages
  await page.goto("/zh-Hant-HK/admin");
  await expect(page).toHaveURL(/\/zh-Hant-HK\/driver$/);
});

test("the 6th wrong PIN is rejected with a localized rate-limit message", async ({ page }) => {
  const username = `nobody-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const form = page.getByTestId("driver-login-form");
  await page.goto("/de/driver/login");
  for (let i = 0; i < 5; i++) {
    await form.locator('input[name="username"]').fill(username);
    await form.locator('input[name="pin"]').fill("000000");
    await page.getByTestId("login-submit").click();
    await expect(page.getByTestId("login-error")).toContainText("fehlgeschlagen");
  }
  await form.locator('input[name="username"]').fill(username);
  await form.locator('input[name="pin"]').fill("000000");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("login-error")).toContainText("Zu viele Fehlversuche");
});
