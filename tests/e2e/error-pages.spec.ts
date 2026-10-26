import { expect, type Page, test } from "@playwright/test";

import { installNetworkEmulation, setOnline } from "./helpers/network";

// NUD-094. Needs a seeded database and a server started with ENABLE_ERROR_TEST_PAGES=true (the
// hidden pages /admin/dev/error and /driver/dev-error raise an error on purpose and are a 404
// otherwise). Uses the seeded admin and the seeded driver `driver-sr`.
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "change-me-local-only";

async function loginAdmin(page: Page, locale = "de") {
  await page.goto(`/${locale}/login`);
  const form = page.getByTestId("admin-login-form");
  await form.locator('input[name="email"]').fill("admin@example.com");
  await form.locator('input[name="password"]').fill(adminPassword);
  await page.getByTestId("login-submit").click();
  // The admin's own language decides where the login lands.
  await expect(page).toHaveURL(/\/admin$/);
}

async function loginDriver(page: Page) {
  await page.goto("/de/driver/login");
  const form = page.getByTestId("driver-login-form");
  await form.locator('input[name="username"]').fill("driver-sr");
  await form.locator('input[name="pin"]').fill("123456");
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/sr-Latn\/driver$/);
}

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test.describe("admin", () => {
  for (const locale of ["de", "zh-Hans"] as const) {
    test(`friendly error page inside the admin shell (${locale})`, async ({ page }) => {
      await loginAdmin(page, locale);
      await page.goto(`/${locale}/admin/dev/error`);
      const error = page.getByTestId("admin-error");
      await expect(error).toBeVisible();
      // Friendly text, an error reference, but never the technical message.
      await expect(error).toContainText(locale === "de" ? "Etwas ist schiefgelaufen" : "出错了");
      await expect(page.getByTestId("admin-error-reference")).toContainText(/[0-9]{6,}/);
      await expect(error).not.toContainText("Forced test error");
      // The shell (navigation) is still there, so the office can leave the page.
      await expect(page.getByTestId("admin-shell")).toBeVisible();
      expect(await noHorizontalScroll(page)).toBe(true);
      await error.getByRole("link").click();
      await expect(page).toHaveURL(new RegExp(`/${locale}/admin$`));
    });
  }
});

test.describe("driver", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("friendly page with a retry button; shell stays; no horizontal scroll", async ({
    page,
    context,
  }) => {
    await installNetworkEmulation(context);
    await loginDriver(page);
    await page.goto("/sr-Latn/driver/dev-error");
    const error = page.getByTestId("driver-error");
    await expect(error).toBeVisible();
    await expect(error).toHaveAttribute("data-connection", "online");
    await expect(error).toContainText("Nešto je pošlo naopako");
    await expect(error).not.toContainText("Forced test error");
    // The app shell with the connection indicator and the sync of queued taps stays mounted.
    await expect(page.getByTestId("driver-shell")).toBeVisible();
    expect(await noHorizontalScroll(page)).toBe(true);
    for (const target of [page.getByTestId("driver-error-retry"), error.getByRole("link")]) {
      expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    }
    // Retry runs and, as the page still fails, shows the page again (no crash, no blank screen).
    await page.getByTestId("driver-error-retry").click();
    await expect(error).toBeVisible();
    await error.getByRole("link").click();
    await expect(page).toHaveURL(/\/sr-Latn\/driver$/);
  });

  test("offline: calm wording, no error message; reloads when the connection returns", async ({
    page,
    context,
  }) => {
    await installNetworkEmulation(context);
    await loginDriver(page);
    await page.goto("/de/driver/dev-error");
    const error = page.getByTestId("driver-error");
    await expect(error).toHaveAttribute("data-connection", "online");
    await expect(error).toContainText("Etwas ist schiefgelaufen");

    await setOnline(context, page, false);
    await expect(error).toHaveAttribute("data-connection", "offline");
    await expect(error).toContainText("Keine Verbindung");
    await expect(error).not.toContainText("schiefgelaufen");
    await expect(error).toContainText("auf dem Handy gesichert");
    expect(await noHorizontalScroll(page)).toBe(true);

    // Back online: the page reloads by itself and shows the (still failing) page again. Wait for the
    // navigation, not for `load`: the reload is answered by the service worker, and its `load` event
    // does not surface on the page object here (the navigation itself does).
    const reloaded = page.waitForEvent("framenavigated");
    await setOnline(context, page, true);
    await reloaded;
    await expect(page.getByTestId("driver-error")).toHaveAttribute("data-connection", "online");
  });
});
