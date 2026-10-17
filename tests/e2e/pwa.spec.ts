import { expect, type Page, test } from "@playwright/test";
import bcrypt from "bcryptjs";
import { Client } from "pg";

// NUD-080. Needs DATABASE_URL (own driver user) and a PRODUCTION build (`pnpm build && pnpm start`):
// the service worker is only built by `pnpm build` (scripts/build-pwa.ts) and only registered in
// production. Phone viewport.
test.use({ viewport: { width: 375, height: 812 } });

const PIN = "482916";
const tag = `pwa${Date.now() % 1e8}${Math.floor(Math.random() * 1e4)}`;
const username = `drv-${tag}`;
const LOCALES = ["de", "zh-Hans", "zh-Hant-HK", "zh-Hant-TW"] as const;
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";

let db: Client;
let userId: string;

test.beforeAll(async () => {
  db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  userId = `id-${tag}`;
  await db.query(
    `INSERT INTO "User" ("id","role","username","passwordHash","locale","localeChosen","displayName","updatedAt")
     VALUES ($1,'DRIVER',$2,$3,'de',true,'PWA Driver',now())`,
    [userId, username, await bcrypt.hash(PIN, 10)],
  );
});

test.afterAll(async () => {
  await db
    .query(`DELETE FROM "LoginAttempt" WHERE "key" LIKE $1`, [`%${username}%`])
    .catch(() => {});
  await db.query(`DELETE FROM "User" WHERE "id"=$1`, [userId]);
  await db.end();
});

async function login(page: Page) {
  await page.goto("/de/driver/login");
  const form = page.getByTestId("driver-login-form");
  await form.locator('input[name="username"]').fill(username);
  await form.locator('input[name="pin"]').fill(PIN);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/de\/driver$/);
}

const swControlled = (page: Page) =>
  page.waitForFunction(() => navigator.serviceWorker?.controller !== null, undefined, {
    timeout: 30_000,
  });

const pngSize = (body: Buffer) => ({ w: body.readUInt32BE(16), h: body.readUInt32BE(20) });

test.describe("manifest, icons and worker are public", () => {
  for (const locale of LOCALES) {
    test(`manifest of ${locale} is valid and reachable without a session`, async ({
      playwright,
      baseURL,
    }) => {
      const anon = await playwright.request.newContext({ baseURL });
      const res = await anon.get(`/${locale}/manifest.webmanifest`, { maxRedirects: 0 });
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toContain("application/manifest+json");
      const m = await res.json();
      expect(m.start_url).toBe(`/${locale}/driver`);
      expect(m.display).toBe("standalone");
      expect(m.lang).toBe(locale);
      expect(m.name).toBeTruthy();
      expect(m.short_name).toBeTruthy();
      expect(m.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(new URL(m.start_url, baseURL).pathname.startsWith(m.scope)).toBe(true);
      const sizes = m.icons.map(
        (i: { sizes: string; purpose: string }) => `${i.sizes}/${i.purpose}`,
      );
      expect(sizes).toEqual(
        expect.arrayContaining([
          "192x192/any",
          "512x512/any",
          "192x192/maskable",
          "512x512/maskable",
        ]),
      );
      for (const icon of m.icons as { src: string; sizes: string; type: string }[]) {
        const r = await anon.get(icon.src, { maxRedirects: 0 });
        expect(r.status(), icon.src).toBe(200);
        expect(r.headers()["content-type"]).toBe("image/png");
        const [w] = icon.sizes.split("x").map(Number);
        expect(pngSize(await r.body())).toEqual({ w, h: w });
      }
      await anon.dispose();
    });
  }

  test("localized names differ per locale; service worker and offline page need no session", async ({
    playwright,
    baseURL,
  }) => {
    const anon = await playwright.request.newContext({ baseURL });
    const names = new Set<string>();
    for (const locale of ["de", "zh-Hans"]) {
      names.add((await (await anon.get(`/${locale}/manifest.webmanifest`)).json()).name);
    }
    expect(names.size).toBe(2);
    const unknown = await anon.get(`/xx/manifest.webmanifest`, { maxRedirects: 0 });
    expect(unknown.status()).toBe(404);
    const sw = await anon.get("/sw.js", { maxRedirects: 0 });
    expect(sw.status()).toBe(200);
    expect(sw.headers()["content-type"]).toContain("javascript");
    expect(sw.headers()["cache-control"]).toContain("no-cache");
    const offline = await anon.get("/offline.html", { maxRedirects: 0 });
    expect(offline.status()).toBe(200);
    await anon.dispose();
  });
});

test("login page links the locale manifest and icons", async ({ page }) => {
  await page.goto("/zh-Hant-TW/driver/login");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    "/zh-Hant-TW/manifest.webmanifest",
  );
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    "href",
    /apple-touch-icon\.png/,
  );
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", /^#/);
});

test("service worker registers, controls the page and the app is installable", async ({
  page,
  context,
}) => {
  await page.goto("/de/driver/login");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await swControlled(page);
  const reg = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration();
    return { scope: r?.scope, active: r?.active?.state, script: r?.active?.scriptURL };
  });
  expect(reg.active).toBe("activated");
  expect(reg.script).toMatch(/\/sw\.js$/);

  // Chromium's own installability check (the criteria Lighthouse uses; Lighthouse itself is not run).
  const cdp = await context.newCDPSession(page);
  await cdp.send("Page.enable");
  const { installabilityErrors } = (await cdp.send("Page.getInstallabilityErrors")) as {
    installabilityErrors: { errorId: string }[];
  };
  expect(installabilityErrors).toEqual([]);
  const { url } = (await cdp.send("Page.getAppManifest")) as { url: string; errors: unknown[] };
  expect(url).toMatch(/\/de\/manifest\.webmanifest$/);
});

test("the worker caches only the app shell, never pages or API data", async ({ page }) => {
  await login(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await swControlled(page);
  // Visit authenticated pages while the worker controls the page.
  await page.goto("/de/driver");
  await expect(page.getByTestId("driver-shell")).toBeVisible();
  await page.goto("/zh-Hans/driver");
  await expect(page.getByTestId("driver-shell")).toBeVisible();
  await page.request.get("/api/health").catch(() => {});

  const urls = await page.evaluate(async () => {
    const out: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const req of await cache.keys())
        out.push(
          new URL(req.url).pathname +
            new URL(req.url).search.replace(/[?&]__WB_REVISION__=\w+/, ""),
        );
    }
    return out;
  });
  expect(urls.length).toBeGreaterThan(10);
  expect(urls).toContain("/offline.html");
  for (const u of urls) {
    expect(u, u).toMatch(/^(\/_next\/static\/|\/icons\/|\/offline\.html$)/);
    expect(u).not.toContain("_rsc");
  }
  // Responses of cached entries are never HTML pages other than the generic offline page.
  const htmlEntries = await page.evaluate(async () => {
    const out: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const req of await cache.keys()) {
        const res = await cache.match(req);
        if (res?.headers.get("content-type")?.includes("text/html"))
          out.push(new URL(req.url).pathname);
      }
    }
    return out;
  });
  expect(htmlEntries).toEqual(["/offline.html"]);
});

test("offline: a driver page shows the generic offline page in the URL's language", async ({
  page,
  context,
}) => {
  await login(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await swControlled(page);
  await context.setOffline(true);
  try {
    await page.goto("/de/driver").catch(() => {});
    await expect(page.locator("h1:visible")).toHaveText("Keine Verbindung");
    await expect(page.locator("body")).not.toContainText("PWA Driver");
    await page.goto("/zh-Hans/driver").catch(() => {});
    await expect(page.locator("h1:visible")).toHaveText("没有网络连接");
    await page.screenshot({ path: "test-results/nud080-offline-zh-Hans.png" });
  } finally {
    await context.setOffline(false);
  }
});

test.describe("install hint on iOS", () => {
  test.use({ userAgent: IPHONE_UA });

  for (const locale of LOCALES) {
    test(`shows the Share -> Add to Home Screen overlay (${locale})`, async ({ page }) => {
      await login(page);
      await page.goto(`/${locale}/driver`);
      const hint = page.getByTestId("install-hint");
      await expect(hint).toBeVisible();
      await expect(hint).toHaveAttribute("data-kind", "ios");
      await expect(page.getByTestId("install-button")).toHaveCount(0);
      await page.getByTestId("install-how").click();
      const overlay = page.getByTestId("install-overlay");
      await expect(overlay).toBeVisible();
      await expect(overlay.getByTestId("install-illustration")).toBeVisible();
      await expect(overlay.getByRole("listitem")).toHaveCount(3);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true);
      await page.screenshot({ path: `test-results/nud080-ios-overlay-${locale}.png` });
      await page.getByTestId("install-overlay-done").click();
      await expect(overlay).toHaveCount(0);
      await expect(hint).toHaveCount(0);
    });
  }

  test("dismissal is remembered across reloads; hint buttons are >= 48 px", async ({ page }) => {
    await login(page);
    await page.goto("/de/driver");
    await expect(page.getByTestId("install-hint")).toBeVisible();
    for (const id of ["install-how", "install-dismiss"]) {
      const box = await page.getByTestId(id).boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(48);
    }
    await page.screenshot({ path: "test-results/nud080-ios-hint-de.png" });
    await page.getByTestId("install-dismiss").click();
    await expect(page.getByTestId("install-hint")).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("driver-shell")).toBeVisible();
    await expect(page.getByTestId("install-hint")).toHaveCount(0);
    expect(
      await page.evaluate(() => localStorage.getItem("nudel.driver.installHint.dismissed")),
    ).toBe("1");
  });

  test("works when localStorage is blocked", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new Error("blocked");
        },
      });
    });
    await login(page);
    await page.goto("/de/driver");
    await expect(page.getByTestId("install-hint")).toBeVisible();
    await page.getByTestId("install-dismiss").click();
    await expect(page.getByTestId("install-hint")).toHaveCount(0);
  });
});

test("Android: install button follows beforeinstallprompt", async ({ page }) => {
  await login(page);
  await page.goto("/de/driver");
  await expect(page.getByTestId("driver-shell")).toBeVisible();
  await expect(page.getByTestId("install-hint")).toHaveCount(0); // nothing to offer yet
  await page.evaluate(() => {
    const event = new Event("beforeinstallprompt", { cancelable: true });
    Object.assign(event, {
      prompt: () => {
        (window as unknown as { __prompted: number }).__prompted =
          ((window as unknown as { __prompted?: number }).__prompted ?? 0) + 1;
        return Promise.resolve();
      },
      userChoice: Promise.resolve({ outcome: "accepted" }),
    });
    window.dispatchEvent(event);
  });
  const hint = page.getByTestId("install-hint");
  await expect(hint).toHaveAttribute("data-kind", "android");
  await page.screenshot({ path: "test-results/nud080-android-hint-de.png" });
  await page.getByTestId("install-button").click();
  await expect(hint).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __prompted: number }).__prompted)).toBe(
    1,
  );
});
