import { expect, test } from "@playwright/test";

test("root redirects to a locale and renders the placeholder", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/(de|zh-Hans|zh-Hant-HK|zh-Hant-TW)$/);
  await expect(page.getByTestId("title")).toBeVisible();
});

test("zh-Hant-TW renders Traditional Chinese with the exact lang", async ({ page }) => {
  await page.goto("/zh-Hant-TW");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hant-TW");
  await expect(page.getByTestId("title")).toHaveText("麵條配送應用");
});
