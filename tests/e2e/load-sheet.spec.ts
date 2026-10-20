import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

import { expect, type Page, test } from "@playwright/test";
import { Client } from "pg";

// NUD-091. Needs a seeded database (demo products, demo driver `fahrer-de`, driver-hk),
// DATABASE_URL and SEED_ADMIN_PASSWORD. Desktop only. The tour (30 stops) is inserted directly,
// so no routing or depot setting is involved.
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "change-me-local-only";
const OUT = "test-results/nud-091";
const STOPS = 30;

/**
 * `pdfinfo` and `pdftotext` come from poppler-utils. The CI runners ship it; a Windows development
 * machine usually does not, so the PDF assertions are skipped there instead of failing the suite.
 */
const hasPoppler = (() => {
  try {
    execFileSync("pdfinfo", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`);

async function loginAdmin(page: Page) {
  await page.goto("/de/login");
  await page.getByLabel("E-Mail").fill("admin@example.com");
  await page.getByLabel("Passwort").fill(adminPassword);
  await tid(page, "login-submit").click();
  await expect(page).toHaveURL(/\/admin$/);
}

async function fixture() {
  const tag = `e2el${Date.now() % 1e8}`;
  const year = 2100 + Math.floor(Math.random() * 7000);
  const day = `${year}-09-15`;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const products = (
    await client.query(
      `SELECT "id","sku","unit","name" FROM "Product" WHERE "active" ORDER BY "sortOrder","sku" LIMIT 5`,
    )
  ).rows as Array<{ id: string; sku: string; unit: string; name: { de: string } }>;
  expect(products.length).toBeGreaterThanOrEqual(3);
  const driver = (
    await client.query(`SELECT "id","displayName" FROM "User" WHERE "username"='fahrer-de'`)
  ).rows[0] as { id: string; displayName: string };

  const tourId = `tour-${tag}`;
  await client.query(
    `INSERT INTO "Tour" ("id","date","driverId","status","depotSnapshot","releaseRevision","updatedAt")
     VALUES ($1,$2,$3,'RELEASED',$4,1,now())`,
    [
      tourId,
      day,
      driver.id,
      JSON.stringify({ name: "Nudelfabrik", address: "Graben 1, 1010 Wien", lat: 48.2, lng: 16.3 }),
    ],
  );
  const expected = new Map<string, number>();
  for (let i = 1; i <= STOPS; i++) {
    const customerId = `id-${tag}-${i}`;
    // some long names / addresses to stress the columns
    const name =
      i % 4 === 0
        ? `Ristorante Trattoria Da Giovanni e Figli Internationale Spaghetteria GmbH & Co. KG Filiale ${i}`
        : `Trattoria ${i} ${tag}`;
    await client.query(
      `INSERT INTO "Customer" ("id","customerNumber","name","street","postalCode","city","lat","lng","pinConfirmed","updatedAt")
       VALUES ($1,$2,$3,$4,'1010','Wien',48.2,16.3,true,now())`,
      [
        customerId,
        `${tag}-${i}`,
        name,
        i % 3 === 0 ? "Sehr-lange-Hauptstraße-mit-Zusatz-und-Hausnummer 123/4/5" : "Hauptstraße 1",
      ],
    );
    const picks = products.filter((_, k) => (i + k) % 2 === 0 || k === 0);
    const items = picks.map((p, k) => ({
      productId: p.id,
      quantityCents: 100 * ((i % 5) + 1) + (k === 1 ? 50 : 0),
    }));
    for (const it of items) {
      expected.set(it.productId, (expected.get(it.productId) ?? 0) + it.quantityCents);
    }
    await client.query(
      `INSERT INTO "Stop" ("id","tourId","customerId","sequence","items") VALUES ($1,$2,$3,$4,$5)`,
      [`stop-${tag}-${i}`, tourId, customerId, i, JSON.stringify(items)],
    );
  }
  return {
    client,
    tag,
    day,
    tourId,
    products,
    expected,
    cleanup: async () => {
      await client.query(`DELETE FROM "Stop" WHERE "tourId"=$1`, [tourId]);
      await client.query(`DELETE FROM "Tour" WHERE "id"=$1`, [tourId]);
      await client.query(`DELETE FROM "Customer" WHERE "id" LIKE $1`, [`id-${tag}-%`]);
      await client.end();
    },
  };
}

test.describe.configure({ mode: "serial" });

test("load sheet: totals, reverse order, 4 locales, A4 print, warning, authorization", async ({
  page,
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "admin print view is a desktop screen");
  test.setTimeout(240_000);
  mkdirSync(OUT, { recursive: true });
  const f = await fixture();
  try {
    await page.route(/\/\d+\/\d+\/\d+\.png/, (route) =>
      route.fulfill({ status: 200, contentType: "image/png", body: Buffer.alloc(0) }),
    );

    // Anonymous: sent to the login page, the sheet is never rendered.
    await page.goto(`/de/admin/tours/${f.tourId}/print`);
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByTestId("load-sheet")).toHaveCount(0);

    await loginAdmin(page);

    // Link from the tour page.
    await page.goto(`/de/admin/tours?date=${f.day}`);
    await tid(page, "tour-print-link").click();
    await expect(page).toHaveURL(new RegExp(`/de/admin/tours/${f.tourId}/print\\?locale=de$`));
    const sheet = tid(page, "load-sheet");
    await expect(sheet).toBeVisible();
    // no admin chrome
    await expect(tid(page, "admin-shell")).toHaveCount(0);
    await expect(page.locator("aside:visible")).toHaveCount(0);
    await expect(page.locator("header:visible")).toHaveCount(1); // only the sheet's own header
    await expect(tid(page, "load-sheet-driver")).toHaveText(/\S/);
    await expect(tid(page, "load-sheet-depot")).toContainText("Nudelfabrik, Graben 1, 1010 Wien");
    await expect(tid(page, "load-sheet-stop-count")).toContainText(`${STOPS}`);

    // Section 1: totals = sum of all stops (checked against the seeded numbers).
    const rows = page.locator('[data-testid="load-sheet-total-row"]:visible');
    await expect(rows).toHaveCount(f.expected.size);
    for (const [productId, cents] of f.expected) {
      const qtyText = await rows
        .and(page.locator(`[data-product-id="${productId}"]`))
        .getByTestId("load-sheet-total-qty")
        .innerText();
      const parsed = Number(qtyText.replace(/\./g, "").replace(",", "."));
      expect(Math.round(parsed * 100)).toBe(cents);
    }
    // ... and equal to the sum of the quantities printed in section 2
    const printedItems = await page
      .locator('[data-testid="load-sheet-item"]:visible')
      .evaluateAll((els) =>
        els.map((el) => ({
          text: el.querySelector("span:last-child")?.textContent ?? "",
        })),
      );
    expect(printedItems.length).toBeGreaterThan(STOPS);

    // Section 2: reverse order, last stop first.
    const seqs = await page
      .locator('[data-testid="load-sheet-stop-seq"]:visible')
      .evaluateAll((els) => els.map((el) => Number(el.textContent)));
    expect(seqs).toEqual(Array.from({ length: STOPS }, (_, i) => STOPS - i));

    // The Print button calls window.print().
    await page.evaluate(() => {
      (window as unknown as { __printed: number }).__printed = 0;
      window.print = () => {
        (window as unknown as { __printed: number }).__printed++;
      };
    });
    await tid(page, "load-sheet-print").click();
    expect(await page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(
      1,
    );

    // Not outdated: no warning anywhere.
    await expect(tid(page, "load-sheet-outdated")).toHaveCount(0);
    await expect(tid(page, "load-sheet-outdated-screen")).toHaveCount(0);

    // Four locales: labels, html lang of the sheet, German name next to the Chinese one, A4 PDF.
    const labels: Record<string, { title: string; firstSection: string }> = {
      de: { title: "Ladeliste", firstSection: "1. Gesamtmenge pro Produkt" },
      "zh-Hans": { title: "装车单", firstSection: "1. 各产品总数量" },
      "zh-Hant-HK": { title: "裝車單", firstSection: "1. 各產品總數量" },
      "zh-Hant-TW": { title: "裝車單", firstSection: "1. 各產品總數量" },
    };
    const germanFirst = f.products[0]!.name.de;
    const pages: Record<string, number> = {};
    for (const [locale, text] of Object.entries(labels)) {
      await page.goto(`/de/admin/tours/${f.tourId}/print?locale=${locale}`);
      await expect(sheet).toHaveAttribute("lang", locale);
      await expect(tid(page, "load-sheet-title")).toHaveText(text.title);
      await expect(sheet).toContainText(text.firstSection);
      await expect(sheet).toContainText(germanFirst);
      await expect(tid(page, `load-sheet-locale-${locale}`)).toHaveAttribute(
        "aria-current",
        "true",
      );
      await page.screenshot({ path: `${OUT}/screen-${locale}.png`, fullPage: true });

      // print layout: A4 content width (210mm - 2 x 12mm = 186mm = 703px), nothing cut off
      await page.emulateMedia({ media: "print" });
      await page.setViewportSize({ width: 703, height: 1000 });
      const overflow = await page.evaluate(() => {
        const root = document.querySelector('[data-testid="load-sheet"]')!;
        const right = root.getBoundingClientRect().right;
        const bad: string[] = [];
        for (const el of root.querySelectorAll("th,td")) {
          if (el.scrollWidth > el.clientWidth + 1)
            bad.push(`scroll:${el.textContent?.slice(0, 30)}`);
          if (el.getBoundingClientRect().right > right + 1)
            bad.push(`out:${el.textContent?.slice(0, 30)}`);
        }
        return {
          bad,
          docOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          toolbar: getComputedStyle(document.querySelector('[data-testid="load-sheet-toolbar"]')!)
            .display,
        };
      });
      expect(overflow).toEqual({ bad: [], docOverflow: false, toolbar: "none" });

      const pdf = await page.pdf({ format: "A4", preferCSSPageSize: true, printBackground: true });
      const file = `${OUT}/load-sheet-${locale}.pdf`;
      writeFileSync(file, pdf);
      if (hasPoppler) {
        const info = execFileSync("pdfinfo", [file]).toString();
        pages[locale] = Number(/Pages:\s+(\d+)/.exec(info)![1]);
        expect(info).toMatch(/Page size:\s+59[45]\.\d+ x 841\.\d+ pts \(A4\)/);
        // the PDF is not blank: title, the first section and a customer of the last page are in it
        const pdfText = execFileSync("pdftotext", ["-layout", file, "-"]).toString();
        const squash = (value: string) => value.replace(/\s+/g, "");
        expect(squash(pdfText)).toContain(squash(text.title));
        expect(squash(pdfText)).toContain(squash(text.firstSection));
        expect(pdfText).toContain(`${f.tag}-1`);
        expect(pdfText).toContain(`${f.tag}-${STOPS}`);
      }
      await page.emulateMedia({ media: "screen" });
      await page.setViewportSize({ width: 1280, height: 800 });
    }
    // 30 stops need more than one page, but not an absurd number
    if (hasPoppler) {
      for (const n of Object.values(pages)) {
        expect(n).toBeGreaterThanOrEqual(2);
        expect(n).toBeLessThanOrEqual(8);
      }
    }
    writeFileSync(`${OUT}/pages.json`, JSON.stringify(pages));

    // Invalid locale falls back to the UI locale of the page.
    for (const bad of ["en", "", "ZH-HANS", "zh"]) {
      await page.goto(`/zh-Hans/admin/tours/${f.tourId}/print?locale=${bad}`);
      await expect(sheet).toHaveAttribute("data-locale", "zh-Hans");
    }
    await page.goto(`/de/admin/tours/${f.tourId}/print`);
    await expect(sheet).toHaveAttribute("data-locale", "de");

    // Unknown tour: the localized not-found page (the status is 200 because the page streams).
    await page.goto(`/de/admin/tours/nope-${f.tourId}/print`);
    await expect(tid(page, "not-found")).toBeVisible();
    await expect(tid(page, "load-sheet")).toHaveCount(0);

    // Outdated tour: loud warning on screen (UI language) and on paper (print language),
    // quantities stay the tour's quantities.
    await f.client.query(`UPDATE "Tour" SET "isOutdated"=true WHERE "id"=$1`, [f.tourId]);
    await page.goto(`/de/admin/tours/${f.tourId}/print?locale=zh-Hans`);
    await expect(tid(page, "load-sheet-outdated-screen")).toBeVisible();
    await expect(tid(page, "load-sheet-outdated-screen")).toContainText("Bestellungen");
    await expect(tid(page, "load-sheet-outdated")).toContainText("注意");
    await page.screenshot({ path: `${OUT}/screen-outdated.png` });
    await page.emulateMedia({ media: "print" });
    await expect(tid(page, "load-sheet-outdated-screen")).toBeHidden();
    await expect(tid(page, "load-sheet-outdated")).toBeVisible();
    await page.emulateMedia({ media: "screen" });
    await expect(rows).toHaveCount(f.expected.size);

    // A driver cannot open the sheet.
    const driverCtx = await browser.newContext();
    const dp = await driverCtx.newPage();
    await dp.goto("/de/driver/login");
    await dp.getByTestId("driver-login-form").locator('input[name="username"]').fill("driver-hk");
    await dp.getByTestId("driver-login-form").locator('input[name="pin"]').fill("123456");
    await dp.getByTestId("login-submit").click();
    await expect(dp).toHaveURL(/\/driver$/);
    await dp.goto(`/de/admin/tours/${f.tourId}/print`);
    await expect(dp).toHaveURL(/\/driver$/);
    await expect(dp.getByTestId("load-sheet")).toHaveCount(0);
    await driverCtx.close();
  } finally {
    await f.cleanup();
  }
});
