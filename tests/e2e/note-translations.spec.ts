import { expect, type Page, test } from "@playwright/test";
import bcrypt from "bcryptjs";
import { Client } from "pg";

// NUD-071. Needs a seeded database, DATABASE_URL and SEED_ADMIN_PASSWORD. No DEEPL_API_KEY is set,
// so the FakeTranslator is used: its output is the German text with a "[<locale>]" prefix (NOT a
// real translation). The spec creates its own customer through the admin UI, then a driver, a
// released tour for TODAY and one stop for that customer.
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "change-me-local-only";
const PIN = "482916";
const tag = `ntr${Date.now() % 1e8}${Math.floor(Math.random() * 1e4)}`;
const username = `drv-${tag}`;
const NOTE = "Hintereingang benutzen, nach 10 Uhr klingeln";
const NEW_NOTE = "Seiteneingang benutzen, ab 9 Uhr klingeln";
const CS_MANUAL = "Použijte zadní vchod, zvonit po desáté";
const TRANSLATED = ["en", "sr-Latn", "cs", "zh-Hans"] as const;
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

let db: Client;
let customerId = "";
const userId = `id-${tag}`;
const tourId = `tour-${tag}`;
const stopId = `stop-${tag}`;

// Next keeps visited routes hidden in the DOM: only look at visible elements.
const vis = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`);

async function stubTiles(page: Page) {
  await page.route(/\/\d+\/\d+\/\d+\.png/, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: PNG }),
  );
}

async function loginAdmin(page: Page) {
  await stubTiles(page);
  await page.goto("/de/login");
  await page.getByLabel("E-Mail").fill("admin@example.com");
  await page.getByLabel("Passwort").fill(adminPassword);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/admin$/);
}

async function openTranslations(page: Page) {
  await page.goto(`/de/admin/customers/${customerId}`);
  await page.getByTestId("tab-translations").click();
  await expect(vis(page, "translations")).toBeVisible();
}

const kindOf = (page: Page, locale: string) =>
  vis(page, `tr-badge-${locale}`).getAttribute("data-kind");

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test.describe.configure({ mode: "serial" });
// Admin screens are desktop screens (1280 px); the driver part opens its own 375 px context.
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop project only");
});

test.beforeAll(async () => {
  db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
});

test.afterAll(async () => {
  await db.query(`DELETE FROM "Stop" WHERE "id"=$1`, [stopId]);
  await db.query(`DELETE FROM "Tour" WHERE "id"=$1`, [tourId]);
  if (customerId) await db.query(`DELETE FROM "Customer" WHERE "id"=$1`, [customerId]);
  await db
    .query(`DELETE FROM "LoginAttempt" WHERE "key" LIKE $1`, [`%${username}%`])
    .catch(() => {});
  await db.query(`DELETE FROM "User" WHERE "id"=$1`, [userId]);
  await db.end();
});

test("admin: a German note is translated on save and shows five versions with badges", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await loginAdmin(page);
  await page.goto("/de/admin/customers/new");
  await page.getByTestId("customer-number").fill(`${tag}-1`);
  await page.getByTestId("customer-name").fill(`Trattoria ${tag}`);
  await page.getByTestId("customer-street").fill("Teststraße 12");
  await page.getByTestId("customer-postal").fill("1010");
  await page.getByTestId("customer-city").fill("Wien");
  await page.getByTestId("customer-notes").fill(NOTE);
  await page.getByTestId("customer-save").click();
  await expect(page).toHaveURL(/\/de\/admin\/customers\/(?!new$)[^/]+$/);
  customerId = page.url().split("/").pop()!;
  await expect(vis(page, "detail-notes")).toHaveText(NOTE);

  await page.getByTestId("tab-translations").click();
  await expect(vis(page, "tr-text-de")).toHaveValue(NOTE);
  expect(await kindOf(page, "de")).toBe("source");
  for (const locale of TRANSLATED) {
    await expect(vis(page, `tr-text-${locale}`)).toHaveValue(`[${locale}] ${NOTE}`);
    expect(await kindOf(page, locale)).toBe("machine");
    await expect(vis(page, `tr-badge-${locale}`)).toHaveText("maschinell übersetzt");
  }
  await expect(vis(page, "translations-pending")).toHaveCount(0);
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("translations-machine.png"), fullPage: true });

  // A released tour of today with one stop at this customer, and a driver.
  await db.query(
    `UPDATE "Customer" SET "lat"=48.2, "lng"=16.37, "pinConfirmed"=true WHERE "id"=$1`,
    [customerId],
  );
  await db.query(
    `INSERT INTO "User" ("id","role","username","passwordHash","locale","localeChosen","displayName","updatedAt")
     VALUES ($1,'DRIVER',$2,$3,'de',true,'Note Driver',now())`,
    [userId, username, await bcrypt.hash(PIN, 10)],
  );
  const tz =
    ((await db.query(`SELECT "timezone" FROM "Settings"`)).rows[0] as { timezone?: string })
      ?.timezone ?? "Europe/Vienna";
  const today = (await db.query(`SELECT (now() AT TIME ZONE $1)::date AS d`, [tz])).rows[0]
    .d as Date;
  await db.query(
    `INSERT INTO "Tour" ("id","date","driverId","status","depotSnapshot","releaseRevision","releasedAt","updatedAt")
     VALUES ($1,$2,$3,'RELEASED',$4::jsonb,1,now(),now())`,
    [
      tourId,
      today,
      userId,
      JSON.stringify({ name: "Depot", address: "Graben 1", lat: 48.2082, lng: 16.3738 }),
    ],
  );
  await db.query(
    `INSERT INTO "Stop" ("id","tourId","customerId","sequence","status","etaAt","legDurationS","items")
     VALUES ($1,$2,$3,1,'PENDING',now(),600,'[]'::jsonb)`,
    [stopId, tourId, customerId],
  );
});

async function driverNote(
  page: Page,
  locale: string,
): Promise<{ text: string; lang: string | null; badge: number }> {
  await page.goto(`/${locale}/driver/stops/${stopId}`);
  await expect(page.getByTestId("stop-notes")).toBeVisible();
  const p = page.getByTestId("stop-notes").locator("p[lang]");
  return {
    text: (await p.textContent()) ?? "",
    lang: await p.getAttribute("lang"),
    badge: await page.getByTestId("notes-lang").count(),
  };
}

test("driver: the note appears in all four translations, no DE badge", async ({
  browser,
}, testInfo) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await context.newPage();
  await stubTiles(page);
  await page.goto("/de/driver/login");
  const form = page.getByTestId("driver-login-form");
  await form.locator('input[name="username"]').fill(username);
  await form.locator('input[name="pin"]').fill(PIN);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/de\/driver$/);

  // German: the source, no badge. Other languages: machine translations (Fake translator: prefixed text).
  expect(await driverNote(page, "de")).toEqual({ text: NOTE, lang: "de", badge: 0 });
  for (const locale of TRANSLATED) {
    const note = await driverNote(page, locale);
    expect(note.text, locale).toContain(NOTE);
    expect(note.text, locale).toMatch(new RegExp(`^\\[${locale}\\] `));
    expect(note.lang, locale).toBe(locale);
    expect(note.badge, `${locale} DE badge`).toBe(0);
    expect(await noHorizontalScroll(page)).toBe(true);
  }
  await page.screenshot({
    path: testInfo.outputPath("driver-note-cs.png"),
    fullPage: true,
  });
  await context.close();
});

test("admin: edit cs, change the German source, check warning, re-translate", async ({
  browser,
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  await loginAdmin(page);
  await openTranslations(page);

  // Editing a version removes its "machine-translated" badge at once; saving keeps it removed.
  expect(await kindOf(page, "cs")).toBe("machine");
  await vis(page, "tr-text-cs").fill(CS_MANUAL);
  expect(await kindOf(page, "cs")).toBe("manual");
  await vis(page, "translations-save").click();
  await expect(vis(page, "translations-save")).toBeDisabled(); // nothing left to save
  expect(await kindOf(page, "cs")).toBe("manual");
  expect(await kindOf(page, "zh-Hans")).toBe("machine");
  expect(await kindOf(page, "sr-Latn")).toBe("machine");
  await expect(vis(page, "tr-stale-cs")).toHaveCount(0);

  // Change the German source in the customer form.
  await page.goto(`/de/admin/customers/${customerId}/edit`);
  // The form shows the stored German note; wait for it so the fill happens after hydration.
  await expect(page.getByTestId("customer-notes")).toHaveValue(NOTE);
  // A fill that lands while React is still hydrating the textarea can end up appended to the
  // old text; filling again once hydrated replaces it.
  await expect(async () => {
    await page.getByTestId("customer-notes").fill(NEW_NOTE);
    await expect(page.getByTestId("customer-notes")).toHaveValue(NEW_NOTE, { timeout: 1000 });
  }).toPass();
  await page.getByTestId("customer-save").click();
  await expect(page).toHaveURL(new RegExp(`/de/admin/customers/${customerId}$`));
  await page.getByTestId("tab-translations").click();
  await expect(vis(page, "tr-text-de")).toHaveValue(NEW_NOTE);
  await expect(vis(page, "tr-text-cs")).toHaveValue(CS_MANUAL); // survived
  await expect(vis(page, "tr-stale-cs")).toHaveText("Quelle geändert, Übersetzung prüfen");
  await expect(vis(page, "tr-stale-zh-Hans")).toHaveCount(0);
  await expect(vis(page, "tr-stale-sr-Latn")).toHaveCount(0);
  await expect(vis(page, "tr-text-zh-Hans")).toHaveValue(`[zh-Hans] ${NEW_NOTE}`);
  await expect(vis(page, "tr-text-sr-Latn")).toHaveValue(`[sr-Latn] ${NEW_NOTE}`);
  expect(await kindOf(page, "cs")).toBe("manual");
  expect(await kindOf(page, "zh-Hans")).toBe("machine");
  await page.screenshot({ path: testInfo.outputPath("translations-stale.png"), fullPage: true });

  // The driver (Czech) still reads the hand-written text; Simplified follows the new source.
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const driver = await context.newPage();
  await stubTiles(driver);
  await driver.goto("/de/driver/login");
  const form = driver.getByTestId("driver-login-form");
  await form.locator('input[name="username"]').fill(username);
  await form.locator('input[name="pin"]').fill(PIN);
  await driver.getByTestId("login-submit").click();
  await expect(driver).toHaveURL(/\/de\/driver$/);
  const cs = await driverNote(driver, "cs");
  expect(cs.text).toBe(CS_MANUAL);
  expect(cs.badge).toBe(0);
  await driver.screenshot({
    path: testInfo.outputPath("driver-note-cs-manual.png"),
    fullPage: true,
  });
  expect((await driverNote(driver, "zh-Hans")).text).toBe(`[zh-Hans] ${NEW_NOTE}`);
  expect((await driverNote(driver, "sr-Latn")).text).toBe(`[sr-Latn] ${NEW_NOTE}`);
  await context.close();

  // "Mark as checked" clears only the flag.
  await vis(page, "tr-checked-cs").click();
  await expect(vis(page, "tr-stale-cs")).toHaveCount(0);
  await vis(page, "translations-save").click();
  await expect(vis(page, "translations-save")).toBeDisabled();
  await page.reload();
  await page.getByTestId("tab-translations").click();
  await expect(vis(page, "tr-stale-cs")).toHaveCount(0);
  await expect(vis(page, "tr-text-cs")).toHaveValue(CS_MANUAL);

  // Re-translate warns that manual edits are overwritten; cancelling changes nothing.
  await vis(page, "translations-retranslate").click();
  await expect(page.getByTestId("retranslate-warning")).toContainText("gehen dabei verloren");
  await page.screenshot({ path: testInfo.outputPath("retranslate-warning.png") });
  await page.keyboard.press("Escape");
  await expect(vis(page, "tr-text-cs")).toHaveValue(CS_MANUAL);
  await vis(page, "translations-retranslate").click();
  await page.getByTestId("retranslate-confirm").click();
  await expect(vis(page, "tr-text-cs")).toHaveValue(new RegExp(NEW_NOTE));
  expect(await kindOf(page, "cs")).toBe("machine");
});
