import { expect, type Page, test as base } from "@playwright/test";

import {
  createDriverFixture,
  type DriverFixture,
  loginDriver,
  stubImages,
} from "./helpers/driver-fixture";
import { gotoSettled, installNetworkEmulation, setOnline } from "./helpers/network";

// NUD-142. Needs DATABASE_URL, S3_* and a PRODUCTION build (service worker for the offline test).
// Own driver, customers and a released tour for TODAY (shared driver fixture). The driver sets and
// corrects the customer's key at the next-stop card and the stop detail; the office sees it with
// the driver's name and the history, and edits it on the customer form.
const test = base.extend<{ fx: DriverFixture }>({
  fx: async ({}, provide) => {
    const fx = await createDriverFixture("key");
    await provide(fx);
    await fx.cleanup();
  },
});

const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "change-me-local-only";

const customerOf = (fx: DriverFixture, i: number) => `cust-${i}-${fx.tag}`;
const customerKey = async (fx: DriverFixture, i: number) =>
  (
    await fx.db.query(
      `SELECT "hasKey","keyNumber","keyUpdatedById" FROM "Customer" WHERE "id"=$1`,
      [customerOf(fx, i)],
    )
  ).rows[0] as { hasKey: boolean | null; keyNumber: string | null; keyUpdatedById: string | null };
const keyAudits = async (fx: DriverFixture, i: number) =>
  (
    await fx.db.query(
      `SELECT "actorId","diff" FROM "AuditLog" WHERE "entity"='Customer' AND "entityId"=$1 AND "action"='customer.key' ORDER BY "createdAt","id"`,
      [customerOf(fx, i)],
    )
  ).rows as Array<{
    actorId: string;
    diff: {
      hasKey: { from: boolean | null; to: boolean | null };
      keyNumber: { from: string | null; to: string | null };
      via: string;
    };
  }>;

// The driver pages exist twice in the DOM while the offline shell takes over; only one is visible.
const visibleChip = (page: Page, scope: string) =>
  page.locator(`[data-testid="${scope}"]:visible [data-testid="key-chip"]:visible`).first();

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

/** Fills the key sheet that is open: "Ja" + number, or "Nein". */
async function fillKeySheet(page: Page, value: string | null) {
  const sheet = page.getByTestId("key-sheet");
  await expect(sheet).toBeVisible();
  if (value === null) {
    await sheet.getByTestId("key-no").click();
  } else {
    await sheet.getByTestId("key-yes").click();
    await sheet.getByTestId("key-number").fill(value);
  }
  await sheet.getByTestId("key-save").click();
  await expect(sheet).toBeHidden();
}

test.describe("driver", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test("sets a missing key on the next-stop card and corrects it on the stop detail", async ({
    page,
    fx,
  }) => {
    test.setTimeout(120_000);
    await fx.reset();
    await loginDriver(page, fx);

    const chip = visibleChip(page, "next-stop");
    await expect(chip).toHaveAttribute("data-key", "unknown");
    await expect(chip).toHaveText(/\?/);
    const box = (await chip.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(48);
    expect(box.width).toBeGreaterThanOrEqual(48);
    // The rows of the stop list show the key display only (the row is a link as a whole).
    const rowChip = page.getByTestId("stop-row").nth(1).getByTestId("key-chip");
    await expect(rowChip).toHaveAttribute("data-key", "unknown");
    await expect(page.getByTestId("stop-row").nth(1).getByRole("button")).toHaveCount(0);

    await chip.click();
    // The sheet is readable at 375 px and its controls are 48 px high.
    const yes = page.getByTestId("key-yes");
    await expect(yes).toBeVisible();
    expect((await yes.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    expect(await noHorizontalScroll(page)).toBe(true);
    await expect(page.getByTestId("key-save")).toBeDisabled();
    await fillKeySheet(page, "17");

    await expect(chip).toHaveAttribute("data-key", "number");
    await expect(chip).toContainText("17");
    await expect
      .poll(() => customerKey(fx, 0))
      .toMatchObject({
        hasKey: true,
        keyNumber: "17",
        keyUpdatedById: fx.userId,
      });
    expect(await noHorizontalScroll(page)).toBe(true);

    // The stop detail header shows it too; a tap corrects it.
    await page.goto(`/de/driver/stops/${fx.stopIds[0]}`);
    const detailChip = visibleChip(page, "stop-header");
    await expect(detailChip).toContainText("17");
    expect((await detailChip.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    await detailChip.click();
    await expect(page.getByTestId("key-number")).toHaveValue("17");
    await fillKeySheet(page, "71");
    await expect(detailChip).toContainText("71");
    await expect.poll(async () => (await customerKey(fx, 0)).keyNumber).toBe("71");

    // The audit log holds both changes with the old value.
    await expect.poll(async () => (await keyAudits(fx, 0)).length).toBe(2);
    const [first, second] = await keyAudits(fx, 0);
    expect(first!.actorId).toBe(fx.userId);
    expect(first!.diff).toMatchObject({
      hasKey: { from: null, to: true },
      keyNumber: { from: null, to: "17" },
    });
    expect(second!.diff).toMatchObject({ keyNumber: { from: "17", to: "71" } });

    // "No key" drops the number.
    await detailChip.click();
    await fillKeySheet(page, null);
    await expect(detailChip).toHaveAttribute("data-key", "none");
    await expect.poll(() => customerKey(fx, 0)).toMatchObject({ hasKey: false, keyNumber: null });
  });

  test("works offline: queued, shown at once, sent when the connection is back", async ({
    page,
    context,
    fx,
  }) => {
    test.setTimeout(180_000);
    await fx.reset();
    await installNetworkEmulation(context);
    await stubImages(page);
    await loginDriver(page, fx);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, undefined, {
      timeout: 30_000,
    });
    await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });

    await setOnline(context, page, false);
    await gotoSettled(page, `/de/driver/stops/${fx.stopIds[1]}`);
    const chip = visibleChip(page, "stop-header");
    await expect(chip).toHaveAttribute("data-key", "unknown");
    await chip.click();
    await fillKeySheet(page, "B-4");
    await expect(chip).toContainText("B-4");
    expect(await customerKey(fx, 1)).toMatchObject({ hasKey: null });

    await setOnline(context, page, true);
    await expect
      .poll(() => customerKey(fx, 1), { timeout: 30_000 })
      .toMatchObject({
        hasKey: true,
        keyNumber: "B-4",
        keyUpdatedById: fx.userId,
      });
    expect((await keyAudits(fx, 1)).map((a) => a.diff.via)).toEqual(["sync"]);
    await expect(visibleChip(page, "stop-header")).toContainText("B-4");
  });
});

test.describe("office", () => {
  test("sees the driver's entry with name and history, and edits the key on the form", async ({
    page,
    fx,
  }) => {
    test.setTimeout(120_000);
    const customerId = customerOf(fx, 2);
    await fx.db.query(
      `UPDATE "Customer" SET "hasKey"=true, "keyNumber"='71', "keyUpdatedById"=$2, "keyUpdatedAt"=now() WHERE "id"=$1`,
      [customerId, fx.userId],
    );
    for (const [from, to] of [
      [null, "17"],
      ["17", "71"],
    ] as const) {
      await fx.db.query(
        `INSERT INTO "AuditLog" ("id","actorId","entity","entityId","action","diff")
         VALUES ($1,$2,'Customer',$3,'customer.key',$4::jsonb)`,
        [
          `audit-${fx.tag}-${to}`,
          fx.userId,
          customerId,
          JSON.stringify({
            hasKey: { from: from === null ? null : true, to: true },
            keyNumber: { from, to },
            via: "sync",
          }),
        ],
      );
    }

    await page.goto("/de/login");
    await page.getByLabel("E-Mail").fill("admin@example.com");
    await page.getByLabel("Passwort").fill(adminPassword);
    await page.getByTestId("login-submit").click();
    await expect(page).toHaveURL(/\/admin$/);

    await page.goto(`/de/admin/customers/${customerId}`);
    await expect(page.getByTestId("detail-key")).toHaveText("Schlüssel Nr. 71");
    await expect(page.getByTestId("detail-key-meta")).toContainText("Fahrer A11y Driver");
    await page.getByTestId("key-history").locator("summary").click();
    const rows = page.getByTestId("key-history-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText("Schlüssel Nr. 17 → Schlüssel Nr. 71");
    await expect(rows.last()).toContainText("Unbekannt → Schlüssel Nr. 17");
    expect(await noHorizontalScroll(page)).toBe(true);

    await page.goto(`/de/admin/customers/${customerId}/edit`);
    await expect(page.getByTestId("customer-has-key")).toHaveValue("yes");
    await expect(page.getByTestId("customer-key-number")).toHaveValue("71");
    await page.getByTestId("customer-key-number").fill("A-1");
    await page.getByTestId("customer-save").click();
    await expect(page).toHaveURL(new RegExp(`/de/admin/customers/${customerId}$`));
    await expect(page.getByTestId("detail-key")).toHaveText("Schlüssel Nr. A-1");
    await expect(page.getByTestId("detail-key-meta")).toContainText("Geändert von");
    expect((await customerKey(fx, 2)).keyNumber).toBe("A-1");
    const last = (await keyAudits(fx, 2)).at(-1)!;
    expect(last.diff).toMatchObject({ keyNumber: { from: "71", to: "A-1" }, via: "office" });

    // Saving the form without touching the key leaves a newer driver entry alone.
    await page.goto(`/de/admin/customers/${customerId}/edit`);
    await fx.db.query(`UPDATE "Customer" SET "keyNumber"='Z-9' WHERE "id"=$1`, [customerId]);
    await page.getByTestId("customer-hours").fill("Mo-Fr 8-12");
    await page.getByTestId("customer-save").click();
    await expect(page).toHaveURL(new RegExp(`/de/admin/customers/${customerId}$`));
    expect((await customerKey(fx, 2)).keyNumber).toBe("Z-9");
  });
});
