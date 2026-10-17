import { expect, test } from "@playwright/test";

test("placeholder page renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("title")).toHaveText("Nudel Liefer App");
});
