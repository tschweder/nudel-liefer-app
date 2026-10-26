import { expect, test } from "@playwright/test";

test("root redirects to a locale and renders the placeholder", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/(de|en|sr-Latn|cs|zh-Hans)$/);
  await expect(page.getByTestId("title")).toBeVisible();
});

for (const locale of ["de", "en", "sr-Latn", "cs", "zh-Hans"]) {
  test(`${locale} renders with the exact lang`, async ({ page }) => {
    await page.goto(`/${locale}`);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.getByTestId("title")).not.toBeEmpty();
  });
}
