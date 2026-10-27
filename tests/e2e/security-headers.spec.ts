import { createHash } from "node:crypto";

import { type APIRequestContext, expect, type Page, test } from "@playwright/test";

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

const cspOf = (headers: Record<string, string>) =>
  headers["content-security-policy"] ?? headers["content-security-policy-report-only"] ?? "";
const scriptSrcOf = (csp: string) =>
  csp
    .split(";")
    .map((d) => d.trim())
    .find((d) => d.startsWith("script-src "))
    ?.split(/\s+/)
    .slice(1) ?? [];
/** `next dev` keeps `'unsafe-inline'` and `'unsafe-eval'` for HMR; the strict policy is a production one. */
async function isProductionPolicy(request: APIRequestContext) {
  const response = await request.get("/de/login");
  return !scriptSrcOf(cspOf(response.headers())).includes("'unsafe-eval'");
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
    expect(h["permissions-policy"], path).toContain("geolocation=(self)");
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
  await page.getByTestId("driver-login-form").locator('input[name="username"]').fill("driver-sr");
  await page.getByTestId("driver-login-form").locator('input[name="pin"]').fill("123456");
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/sr-Latn\/driver$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "sr-Latn");
  await page.goto("/sr-Latn/driver/offline-shell");
  await expect(page.locator("main:visible").first()).toBeVisible();
  await page.goto("/sr-Latn/driver");
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

// NUD-110. Production build only (`pnpm build && pnpm start`); `pnpm dev` keeps 'unsafe-inline'.
test.describe("script-src without 'unsafe-inline' (NUD-110)", () => {
  test("pages: nonce per request, every inline script covered by nonce or hash", async ({
    request,
  }) => {
    test.skip(!(await isProductionPolicy(request)), "development server");
    const nonces = new Set<string>();
    for (const path of [
      "/de/login",
      "/zh-Hans/login",
      "/de",
      "/sr-Latn/driver/offline-shell",
      "/de/does-not-exist",
    ]) {
      const response = await request.get(path);
      const sources = scriptSrcOf(cspOf(response.headers()));
      expect(sources, path).not.toContain("'unsafe-inline'");
      expect(sources, path).not.toContain("'unsafe-eval'");
      expect(sources, path).not.toContain("*");
      expect(sources, path).not.toContain("'strict-dynamic'");
      expect(sources[0], path).toBe("'self'");
      const nonce = sources.find((x) => x.startsWith("'nonce-"));
      expect(nonce, `${path}: nonce`).toBeTruthy();
      nonces.add(nonce!);
      const html = await response.text();
      let inline = 0;
      for (const match of html.matchAll(/<script((?:\s[^>]*)?)>([\s\S]*?)<\/script>/g)) {
        if (/\ssrc=/.test(match[1] ?? "")) continue;
        inline++;
        const attributeNonce = /\snonce="([^"]+)"/.exec(match[1] ?? "")?.[1];
        const hash = `'sha256-${createHash("sha256").update(match[2]!, "utf8").digest("base64")}'`;
        const covered =
          (attributeNonce !== undefined && nonce === `'nonce-${attributeNonce}'`) ||
          sources.includes(hash);
        expect(covered, `${path}: inline script ${match[2]!.slice(0, 60)}`).toBe(true);
      }
      expect(inline, `${path}: has inline scripts`).toBeGreaterThan(0);
    }
    expect(nonces.size, "a new nonce for every response").toBe(5);
  });

  test("API routes, static files and the offline page are script-src 'self' only", async ({
    request,
  }) => {
    test.skip(!(await isProductionPolicy(request)), "development server");
    for (const path of [
      "/api/health",
      "/offline.html",
      "/offline.js",
      "/sw.js",
      "/de/manifest.webmanifest",
    ]) {
      const response = await request.get(path);
      expect(scriptSrcOf(cspOf(response.headers())), path).toEqual(["'self'"]);
    }
    const html = await (await request.get("/offline.html")).text();
    expect(html).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/);
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
  });

  test("an injected inline script and an inline event handler are blocked", async ({
    page,
    request,
  }) => {
    test.skip(!(await isProductionPolicy(request)), "development server");
    test.skip(
      (process.env.CSP_REPORT_ONLY ?? "").toLowerCase() === "true",
      "report-only mode blocks nothing",
    );
    const violations = await watchCsp(page);
    await page.goto("/de/login");
    const ran = await page.evaluate(() => {
      const w = window as unknown as { __xss?: string };
      const script = document.createElement("script");
      script.textContent = "window.__xss = 'inline'";
      document.body.appendChild(script);
      const img = document.createElement("img");
      img.setAttribute("onerror", "window.__xss = 'handler'");
      img.src = "data:image/gif;base64,x";
      document.body.appendChild(img);
      return new Promise<string | undefined>((resolve) => setTimeout(() => resolve(w.__xss), 300));
    });
    expect(ran).toBeUndefined();
    expect(violations.filter((v) => v.startsWith("script-src"))).not.toEqual([]);
  });

  test("the login page hydrates and works under the strict policy", async ({ page, request }) => {
    test.skip(!(await isProductionPolicy(request)), "development server");
    const violations = await watchCsp(page);
    await loginAdmin(page);
    await expect(page.getByTestId("admin-title").first()).toBeVisible();
    expect(violations).toEqual([]);
  });
});
