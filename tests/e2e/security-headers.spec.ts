import { expect, type Page, test } from "@playwright/test";

// NUD-093. Needs a seeded database (`pnpm db:seed`) and SEED_ADMIN_PASSWORD in the environment.
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "change-me-local-only";

// 1x1 transparent PNG: the tests never depend on a live tile server (the CSP still applies to the
// request, only the network answer is stubbed).
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/** Collects every Content-Security-Policy violation of every document the page opens. */
async function watchCsp(page: Page) {
  const violations: string[] = [];
  await page.exposeFunction("__reportCsp", (text: string) => violations.push(text));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      (window as unknown as { __reportCsp: (t: string) => void }).__reportCsp(
        `${event.violatedDirective} blocked=${event.blockedURI} source=${event.sourceFile}:${event.lineNumber}`,
      );
    });
  });
  page.on("console", (message) => {
    if (/Content Security Policy|Content-Security-Policy/i.test(message.text())) {
      violations.push(`console: ${message.text()}`);
    }
  });
  await page.route(/\/\d+\/\d+\/\d+\.png/, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: PNG }),
  );
  return violations;
}

async function loginAdmin(page: Page) {
  await page.goto("/de/login");
  await page.getByLabel("E-Mail").fill("admin@example.com");
  await page.getByLabel("Passwort").fill(adminPassword);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/de\/admin$/);
}

test("pages, API responses and static files carry the security headers", async ({ request }) => {
  for (const path of ["/de/login", "/api/health", "/offline.html", "/de/manifest.webmanifest"]) {
    const response = await request.get(path);
    const h = response.headers();
    const csp = h["content-security-policy"] ?? h["content-security-policy-report-only"];
    expect(csp, `${path}: CSP`).toBeTruthy();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("img-src 'self' data: blob:");
    expect(csp).toContain("https://tile.openstreetmap.org"); // default tile server of MAP_TILE_URL
    expect(h["strict-transport-security"], path).toMatch(/max-age=\d+/);
    expect(h["x-content-type-options"], path).toBe("nosniff");
    expect(h["x-frame-options"], path).toBe("DENY");
    expect(h["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
    expect(h["permissions-policy"], path).toContain("camera=(self)");
    expect(h["permissions-policy"], path).toContain("geolocation=()");
  }
  // the service worker keeps its no-cache rule next to the security headers
  const sw = await request.get("/sw.js");
  expect(sw.headers()["cache-control"]).toContain("no-store");
  expect(
    sw.headers()["content-security-policy"] ?? sw.headers()["content-security-policy-report-only"],
  ).toBeTruthy();
});

test("no CSP violation on login, admin pages and the Leaflet maps", async ({ page }) => {
  test.setTimeout(120_000);
  const violations = await watchCsp(page);
  await page.goto("/de/login");
  await loginAdmin(page);
  for (const path of [
    "/de/admin/dev/maps",
    "/de/admin/customers/new",
    "/de/admin/orders/new",
    "/de/admin/tours",
    "/de/admin/settings",
  ]) {
    await page.goto(path);
    await expect(
      page.locator("main:visible, [data-testid='admin-title']:visible").first(),
    ).toBeVisible();
  }
  await page.goto("/de/admin/dev/maps");
  const tile = page.locator(".leaflet-tile-loaded").first();
  await expect(tile).toBeVisible();
  expect(await tile.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  expect(violations).toEqual([]);
});

test("no CSP violation on the driver pages (login, home, language, offline shell)", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const violations = await watchCsp(page);
  await page.goto("/de/driver/login");
  await page.getByTestId("driver-login-form").locator('input[name="username"]').fill("driver-hk");
  await page.getByTestId("driver-login-form").locator('input[name="pin"]').fill("123456");
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/zh-Hant-HK\/driver$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hant-HK");
  await page.goto("/zh-Hant-HK/driver/offline-shell");
  await expect(page.locator("main:visible").first()).toBeVisible();
  await page.goto("/zh-Hant-HK/driver");
  await expect(page.locator("main:visible").first()).toBeVisible();
  expect(violations).toEqual([]);
});

test("the session cookie is HttpOnly and SameSite=Lax", async ({ page, context }) => {
  await loginAdmin(page);
  const session = (await context.cookies()).find((c) => /authjs\.session-token$/.test(c.name));
  expect(session, "session cookie").toBeTruthy();
  expect(session!.httpOnly).toBe(true);
  expect(session!.sameSite).toBe("Lax");
  expect(session!.path).toBe("/");
  // Secure (and the __Secure- prefix) is added by Auth.js on https only; http://localhost has neither.
  expect(session!.secure).toBe(page.url().startsWith("https:"));
});

test("state-changing API routes refuse a foreign Origin even with a valid session", async ({
  page,
  context,
}) => {
  await loginAdmin(page);
  const evil = { origin: "https://evil.example", "content-type": "application/json" };
  const refused = await context.request.post("/api/uploads", {
    headers: evil,
    data: { purpose: "customer-photo", contentType: "image/jpeg", size: 1000 },
  });
  expect(refused.status()).toBe(403);
  expect(await refused.json()).toEqual({ error: "bad_origin" });
  const sameOrigin = await context.request.post("/api/uploads", {
    headers: { origin: new URL(page.url()).origin, "content-type": "application/json" },
    data: { purpose: "customer-photo", contentType: "image/jpeg", size: 1000 },
  });
  expect(sameOrigin.status()).toBe(200);
  // cross-site form post (browser sets Sec-Fetch-Site: cross-site)
  const crossSite = await context.request.post("/api/uploads", {
    headers: { "sec-fetch-site": "cross-site", "content-type": "application/json" },
    data: { purpose: "customer-photo", contentType: "image/jpeg", size: 1000 },
  });
  expect(crossSite.status()).toBe(403);
});

test("an open-redirect callbackUrl lands on the own home page", async ({ page }) => {
  await page.goto("/de/login?callbackUrl=" + encodeURIComponent("https://evil.example/de/admin"));
  await page.getByLabel("E-Mail").fill("admin@example.com");
  await page.getByLabel("Passwort").fill(adminPassword);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/de\/admin$/);
  expect(new URL(page.url()).hostname).not.toBe("evil.example");
});
