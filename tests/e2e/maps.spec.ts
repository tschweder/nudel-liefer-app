import { expect, type Page, test } from "@playwright/test";

// Needs a seeded database (`pnpm db:seed`) and SEED_ADMIN_PASSWORD in the environment.
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "change-me-local-only";

// 1x1 transparent PNG: the tests never depend on a live tile server.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

async function stubTiles(page: Page) {
  await page.route(/\/\d+\/\d+\/\d+\.png/, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: PNG }),
  );
}

async function loginAdmin(page: Page) {
  await page.goto("/de/login");
  await page.getByLabel("E-Mail").fill("admin@example.com");
  await page.getByLabel("Passwort").fill(adminPassword);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/de\/admin$/);
}

const COORDS = /^-?\d+\.\d{6}, -?\d+\.\d{6}$/;

test("dev maps page: pin picker (click, drag, locate) and tour map", async ({ page }) => {
  test.setTimeout(120_000);
  await stubTiles(page);
  await loginAdmin(page);
  await page.goto("/de/admin/dev/maps");
  await expect(page.getByTestId("section-title")).toBeVisible();

  const picker = page.getByTestId("pin-picker");
  const value = page.getByTestId("pin-value");
  await expect(value).toHaveText("Noch kein Adresspunkt gesetzt.");

  // Click-to-place -> 6-decimal coordinates.
  const map = picker.locator(".leaflet-container");
  await map.scrollIntoViewIfNeeded();
  const box = (await map.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(value).toHaveText(COORDS);
  const placed = await value.textContent();

  // Dragging the marker calls onChange with new rounded coordinates.
  const marker = picker.locator(".leaflet-marker-icon");
  await expect(marker).toHaveCount(1);
  const m = (await marker.boundingBox())!;
  await page.mouse.move(m.x + m.width / 2, m.y + m.height / 2);
  await page.mouse.down();
  await page.mouse.move(m.x + m.width / 2 + 60, m.y + m.height / 2 + 40, { steps: 8 });
  await page.mouse.up();
  await expect(value).not.toHaveText(placed!);
  await expect(value).toHaveText(COORDS);
  await expect(page.getByTestId("pin-changes")).toHaveText("Änderungen: 2");

  // Locate address (admin-only server action; Fake geocoder without ORS key).
  const locate = page.getByTestId("pin-locate");
  await expect(locate).toBeDisabled();
  await page.getByLabel("Adresse", { exact: true }).fill("Graben 1, 1010 Wien");
  const before = await value.textContent();
  await locate.click();
  await expect(value).not.toHaveText(before!);
  await expect(value).toHaveText(COORDS);

  // Tour map: numbered stops, depot, polyline.
  const tour = page.getByTestId("tour-map");
  await expect(tour.getByTestId("stop-marker")).toHaveText(["1", "2", "3"]);
  await expect(tour.getByTestId("depot-marker")).toHaveCount(1);
  await expect(tour.locator("path.leaflet-interactive")).toHaveCount(1);

  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/maps-1280.png", fullPage: true });
});

test("dev maps page is not in the nav and not available to anonymous visitors", async ({
  page,
}) => {
  await page.goto("/de/admin/dev/maps");
  await expect(page).toHaveURL(/\/de\/login/);
  await loginAdmin(page);
  await expect(page.getByRole("navigation").getByRole("link", { name: /Karten/ })).toHaveCount(0);
});
