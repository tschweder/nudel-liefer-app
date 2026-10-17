import { expect, test } from "@playwright/test";

// Needs a seeded database. Works with the Fake storage and with MinIO (only the grant is requested).
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "change-me-local-only";
const grant = { purpose: "customer-photo", contentType: "image/jpeg", size: 1000 };

test("POST /api/uploads without a session is rejected with 401", async ({ request }) => {
  const res = await request.post("/api/uploads", { data: grant });
  expect(res.status()).toBe(401);
});

test("admin gets a presigned grant, bad content types are rejected with 400", async ({ page }) => {
  await page.goto("/de/login");
  await page.getByLabel("E-Mail").fill("admin@example.com");
  await page.getByLabel("Passwort").fill(adminPassword);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/de\/admin$/);

  const ok = await page.request.post("/api/uploads", { data: grant });
  expect(ok.status()).toBe(200);
  const body = await ok.json();
  expect(body.storageKey).toMatch(/^customers\/.+\.jpg$/);
  expect(body.method).toBe("PUT");

  const bad = await page.request.post("/api/uploads", {
    data: { ...grant, contentType: "application/pdf" },
  });
  expect(bad.status()).toBe(400);
});

test("a driver may not upload order screenshots (403) but may upload shop photos", async ({
  page,
}) => {
  await page.goto("/de/driver/login");
  await page.getByTestId("driver-login-form").locator('input[name="username"]').fill("fahrer-de");
  await page.getByTestId("driver-login-form").locator('input[name="pin"]').fill("123456");
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/de\/driver$/);

  const shot = await page.request.post("/api/uploads", {
    data: { ...grant, purpose: "screenshot" },
  });
  expect(shot.status()).toBe(403);
  const photo = await page.request.post("/api/uploads", { data: grant });
  expect(photo.status()).toBe(200);
});
