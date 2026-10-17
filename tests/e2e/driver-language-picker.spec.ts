import { expect, type Page, test } from "@playwright/test";
import bcrypt from "bcryptjs";
import { Client } from "pg";

// NUD-050. Needs DATABASE_URL (the spec inserts its own driver with localeChosen=false, so it is
// deterministic and independent of the seed). Phone-sized viewport in both projects.
test.use({ viewport: { width: 375, height: 812 } });

const PIN = "482916";
const tag = `pick${Date.now() % 1e8}${Math.floor(Math.random() * 1e4)}`;
const username = `drv-${tag}`;
let db: Client;
let userId: string;

test.beforeAll(async () => {
  db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  userId = `id-${tag}`;
  await db.query(
    `INSERT INTO "User" ("id","role","username","passwordHash","locale","localeChosen","displayName","updatedAt")
     VALUES ($1,'DRIVER',$2,$3,'de',false,'Picker Driver',now())`,
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
}

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test("login page offers the language switcher; first login -> picker -> zh-Hant-TW home; second login skips it", async ({
  page,
  context,
}, testInfo) => {
  // Language switcher at the top of the driver login page (icon + own-script labels).
  await page.goto("/de/driver/login");
  const switcher = page.getByTestId("language-switcher");
  await expect(switcher).toBeVisible();
  expect((await switcher.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  await expect(switcher.locator("option")).toHaveText([
    "Deutsch",
    "简体中文",
    "繁體中文（香港）",
    "繁體中文（台灣）",
  ]);
  await switcher.selectOption("zh-Hans");
  await expect(page).toHaveURL(/\/zh-Hans\/driver\/login$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hans");
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("driver-login-zh-Hans.png") });

  // First login: the user's stored locale is de and he has not chosen yet -> picker.
  await login(page);
  await expect(page).toHaveURL(/\/de\/driver\/start$/);
  const picker = page.getByTestId("language-picker");
  await expect(picker).toBeVisible();
  const buttons = picker.getByRole("button");
  await expect(buttons).toHaveText(["Deutsch", "简体中文", "繁體中文（香港）", "繁體中文（台灣）"]);
  for (const button of await buttons.all()) {
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  }
  await expect(picker.getByTestId("pick-zh-Hant-TW")).toHaveAttribute("lang", "zh-Hant-TW");
  await expect(page.getByTestId("driver-shell")).toHaveCount(0);
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("driver-picker-375.png") });

  // The picker cannot be skipped by deep links.
  await page.goto("/de/driver");
  await expect(page).toHaveURL(/\/de\/driver\/start$/);
  await page.goto("/zh-Hans/driver");
  await expect(page).toHaveURL(/\/zh-Hans\/driver\/start$/);
  expect(
    (await db.query(`SELECT "localeChosen" FROM "User" WHERE "id"=$1`, [userId])).rows[0],
  ).toEqual({ localeChosen: false });

  // Choose 繁體中文（台灣）.
  await page.getByTestId("pick-zh-Hant-TW").click();
  await expect(page).toHaveURL(/\/zh-Hant-TW\/driver$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hant-TW");
  await expect(page.getByTestId("driver-shell")).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("driver-home-zh-Hant-TW-375.png") });
  expect(
    (await db.query(`SELECT "locale","localeChosen" FROM "User" WHERE "id"=$1`, [userId])).rows[0],
  ).toEqual({ locale: "zh-Hant-TW", localeChosen: true });

  // Second login (fresh session): straight to the home page in zh-Hant-TW, no picker.
  await context.clearCookies();
  await login(page);
  await expect(page).toHaveURL(/\/zh-Hant-TW\/driver$/);
  await expect(page.getByTestId("driver-shell")).toBeVisible();
  await page.goto("/zh-Hant-TW/driver/start");
  await expect(page).toHaveURL(/\/zh-Hant-TW\/driver$/);

  // Later changes use the language icon in the top bar and keep localeChosen.
  await page.getByTestId("language-switcher").selectOption("de");
  await expect(page).toHaveURL(/\/de\/driver$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  expect(
    (await db.query(`SELECT "locale","localeChosen" FROM "User" WHERE "id"=$1`, [userId])).rows[0],
  ).toEqual({ locale: "de", localeChosen: true });
});
