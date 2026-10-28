import { expect, type Page, test } from "@playwright/test";
import { Client } from "pg";

import { requireDatabaseUrl } from "./helpers/preconditions";

// NUD-152: the planning warning when a tour's planned end is after the assigned driver's shift end,
// or when the tour is planned on a weekday the driver does not work. Needs a migrated + seeded
// database (admin login, settings row) and DATABASE_URL.
//
// The spec prepares its own driver, working time and tour with SQL so it does not depend on the demo
// data: a tour without stops is enough for the warning, which only needs `Tour.totalDurationS`.
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "change-me-local-only";

const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`);

async function loginAdmin(page: Page) {
  await page.goto("/de/login");
  await page.getByLabel("E-Mail").fill("admin@example.com");
  await page.getByLabel("Passwort").fill(adminPassword);
  await tid(page, "login-submit").click();
  await expect(page).toHaveURL(/\/admin$/);
}

/**
 * The first calendar day of the given ISO weekday in a month of 2100 — far enough in the future that
 * the spec never collides with demo data or another spec (each test uses its own month).
 */
const futureDay = (weekdayIso: number, monthIndex: number) => {
  const year = 2100 + Math.floor(monthIndex / 12);
  const month = monthIndex % 12;
  const first = new Date(Date.UTC(year, month, 1));
  const isoOfFirst = ((first.getUTCDay() + 6) % 7) + 1;
  const offset = (weekdayIso - isoOfFirst + 7) % 7;
  return new Date(Date.UTC(year, month, 1 + offset)).toISOString().slice(0, 10);
};

type Fixture = { driverId: string; tourId: string; day: string; client: Client };

/** Minutes since midnight of an "HH:MM" string (06:00 ... 23:59). */
const minutesOf = (time: string) => {
  const [hours, minutes] = time.split(":").map(Number);
  return hours! * 60 + minutes!;
};

async function createFixture(options: {
  weekdayIso: number;
  monthIndex: number;
  shiftEnd: string;
  totalDurationS: number;
  withSchedule: boolean;
}): Promise<Fixture> {
  const client = new Client({ connectionString: requireDatabaseUrl() });
  await client.connect();
  const tag = `e2esched${Date.now() % 1e9}${Math.floor(Math.random() * 1e4)}`;
  const day = futureDay(options.weekdayIso, options.monthIndex);
  const driver = await client.query<{ id: string }>(
    `INSERT INTO "User" (id, role, username, "passwordHash", "displayName", locale, "localeChosen", active, "createdAt", "updatedAt")
     VALUES ($1, 'DRIVER', $2, 'x', $3, 'de', true, true, now(), now()) RETURNING id`,
    [tag, tag, "E2E Fahrer"],
  );
  const driverId = driver.rows[0]!.id;
  if (options.withSchedule) {
    for (const weekday of [1, 2, 3, 4, 5]) {
      await client.query(
        `INSERT INTO "WorkSchedule" (id, "driverId", weekday, "startMinutes", "endMinutes", active, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, true, now(), now())`,
        [`${tag}-${weekday}`, driverId, weekday, minutesOf("06:00"), minutesOf(options.shiftEnd)],
      );
    }
  }
  const tour = await client.query<{ id: string }>(
    `INSERT INTO "Tour" (id, date, "driverId", status, "depotSnapshot", "totalDurationS", "createdAt", "updatedAt")
     VALUES ($1, $2::date, $3, 'DRAFT', '{}'::jsonb, $4, now(), now()) RETURNING id`,
    [`${tag}-tour`, day, driverId, options.totalDurationS],
  );
  return { driverId, tourId: tour.rows[0]!.id, day, client };
}

async function cleanup(fixture: Fixture | null) {
  if (!fixture) return;
  await fixture.client.query(`DELETE FROM "Tour" WHERE id = $1`, [fixture.tourId]);
  await fixture.client.query(`DELETE FROM "WorkSchedule" WHERE "driverId" = $1`, [
    fixture.driverId,
  ]);
  await fixture.client.query(`DELETE FROM "User" WHERE id = $1`, [fixture.driverId]);
  await fixture.client.end();
}

test.describe("Arbeitszeit-Warnung auf der Tour-Seite (NUD-152)", () => {
  test.describe.configure({ mode: "serial" });

  test("warns when the planned end is after the shift end", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "admin planning screen is a desktop screen");
    test.setTimeout(120_000);
    const fixture = await createFixture({
      weekdayIso: 3,
      monthIndex: 0,
      shiftEnd: "14:00",
      // 07:00 + 10 h = 17:00, four hours after the shift end.
      totalDurationS: 10 * 3600,
      withSchedule: true,
    });
    try {
      await loginAdmin(page);
      await page.goto(`/de/admin/tours?date=${fixture.day}&tour=${fixture.tourId}`);
      await expect(tid(page, "tour-planner")).toBeVisible();
      const warning = tid(page, "tour-shift-warning");
      await expect(warning).toBeVisible();
      await expect(warning).toContainText("Tour endet nach der Arbeitszeit");
      await expect(warning).toContainText("E2E Fahrer");
      await page.screenshot({ path: "test-results/nud-152-shift-warning.png", fullPage: false });
    } finally {
      await cleanup(fixture);
    }
  });

  test("warns when the tour is planned on a non-working day", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "admin planning screen is a desktop screen");
    test.setTimeout(120_000);
    const fixture = await createFixture({
      weekdayIso: 6,
      monthIndex: 1,
      shiftEnd: "14:00",
      totalDurationS: 6 * 3600,
      withSchedule: true,
    });
    try {
      await loginAdmin(page);
      await page.goto(`/de/admin/tours?date=${fixture.day}&tour=${fixture.tourId}`);
      await expect(tid(page, "tour-planner")).toBeVisible();
      const warning = tid(page, "tour-shift-warning");
      await expect(warning).toBeVisible();
      await expect(warning).toContainText("Tour an einem Ruhetag");
    } finally {
      await cleanup(fixture);
    }
  });

  test("shows no warning for a driver without working time", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "admin planning screen is a desktop screen");
    test.setTimeout(120_000);
    const fixture = await createFixture({
      weekdayIso: 3,
      monthIndex: 2,
      shiftEnd: "14:00",
      totalDurationS: 10 * 3600,
      withSchedule: false,
    });
    try {
      await loginAdmin(page);
      await page.goto(`/de/admin/tours?date=${fixture.day}&tour=${fixture.tourId}`);
      await expect(tid(page, "tour-planner")).toBeVisible();
      await expect(tid(page, "tour-shift-warning")).toHaveCount(0);
    } finally {
      await cleanup(fixture);
    }
  });
});
