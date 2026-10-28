// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hashSecret } from "./auth/password";
import { createTestDb, type TestDb } from "./test-db";

const { getTourPlan } = await import("./tour-planning");
const { readUtilization } = await import("./utilization");
const { readWorkSchedule, saveWorkScheduleWith } = await import("./work-schedule");

const TZ = "Europe/Vienna";
/** Monday 19 October 2026 in the factory time zone (CEST, UTC+2). */
const MONDAY = "2026-10-19";
const TUESDAY = "2026-10-20";
const SATURDAY = "2026-10-24";

const DAYS = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  active: true,
  start: "06:00",
  end: "14:00",
}));

const schedule = (driverId: string) => ({ driverId, days: DAYS });

/**
 * NUD-152: working days/hours per driver (`WorkSchedule`), the measured working time of a tour and
 * the utilization report built from it — including the skipped-checklist fallback and the planning
 * warning on the tour page.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  "driver working time and utilization",
  { timeout: 60_000 },
  () => {
    let t: TestDb;
    let adminId: string;
    let driverId: string;
    let otherDriverId: string;
    let unmeasuredTourId: string;
    let measuredTourId: string;

    beforeAll(async () => {
      t = await createTestDb();
      const hash = await hashSecret("123456");
      adminId = (
        await t.prisma.user.create({
          data: { role: "ADMIN", email: "a@example.com", displayName: "Büro", passwordHash: hash },
        })
      ).id;
      driverId = (
        await t.prisma.user.create({
          data: { role: "DRIVER", username: "hans", displayName: "Hans", passwordHash: hash },
        })
      ).id;
      otherDriverId = (
        await t.prisma.user.create({
          data: { role: "DRIVER", username: "erika", displayName: "Erika", passwordHash: hash },
        })
      ).id;
      await t.prisma.settings.create({
        data: {
          id: 1,
          depotName: "Nudelfabrik",
          depotAddress: "Graben 1, 1010 Wien",
          depotLat: 48.2,
          depotLng: 16.37,
          depotPinConfirmed: true,
          timezone: TZ,
          departureTime: "07:00",
          serviceMinutesPerStop: 10,
          defaultLoadingMinutes: 20,
        },
      });

      // A completed tour: loading 06:40 local, departure 07:00, planned 6 h, last stop done 12:20.
      const tour = await t.prisma.tour.create({
        data: {
          date: new Date(`${MONDAY}T00:00:00Z`),
          driverId,
          status: "COMPLETED",
          releaseRevision: 1,
          totalDurationS: 6 * 3600,
          loadingStartedAt: new Date("2026-10-19T04:40:00Z"),
          departedAt: new Date("2026-10-19T05:00:00Z"),
          completedAt: new Date("2026-10-19T10:20:00Z"),
          depotSnapshot: { name: "Nudelfabrik", address: "x", lat: 48.2, lng: 16.37 },
        },
      });
      const stops = [
        { eta: "2026-10-19T06:00:00Z", done: "2026-10-19T06:12:00Z" },
        { eta: "2026-10-19T10:00:00Z", done: "2026-10-19T10:20:00Z" },
      ];
      measuredTourId = tour.id;
      for (const [index, stop] of stops.entries()) {
        const customer = await t.prisma.customer.create({
          data: {
            customerNumber: `K${index + 1}`,
            name: `Trattoria ${index + 1}`,
            street: "Hauptstraße 1",
            postalCode: "1010",
            city: "Wien",
            lat: 48.2,
            lng: 16.3,
          },
        });
        await t.prisma.stop.create({
          data: {
            tourId: tour.id,
            customerId: customer.id,
            sequence: index + 1,
            items: [],
            etaAt: new Date(stop.eta),
            completedAt: new Date(stop.done),
            status: "DELIVERED",
            legDurationS: 600,
          },
        });
      }

      // A tour without timestamps: not measurable, reported with a reason.
      unmeasuredTourId = (
        await t.prisma.tour.create({
          data: {
            date: new Date(`${MONDAY}T00:00:00Z`),
            driverId: otherDriverId,
            status: "DRAFT",
            depotSnapshot: {},
          },
        })
      ).id;
    });

    afterAll(async () => {
      await t?.teardown();
    });

    it("stores the working days and hours of a driver and audits the change", async () => {
      const saved = await saveWorkScheduleWith(t.prisma, adminId, schedule(driverId));
      expect(saved).toEqual({ ok: true });
      const stored = await readWorkSchedule(t.prisma, driverId);
      expect(
        stored.map((day) => [day.weekday, day.startMinutes, day.endMinutes, day.active]),
      ).toEqual([
        [1, 360, 840, true],
        [2, 360, 840, true],
        [3, 360, 840, true],
        [4, 360, 840, true],
        [5, 360, 840, true],
      ]);
      const audit = await t.prisma.auditLog.findMany({
        where: { entity: "Driver", entityId: driverId },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ action: "driver.schedule_update", actorId: adminId });
      expect(JSON.stringify(audit[0]!.diff)).toContain("1 360-840");
    });

    it("switches a weekday off without deleting the row (soft delete)", async () => {
      const saved = await saveWorkScheduleWith(t.prisma, adminId, {
        driverId,
        days: DAYS.map((day) => (day.weekday === 5 ? { ...day, active: false } : day)),
      });
      expect(saved).toEqual({ ok: true });
      const stored = await readWorkSchedule(t.prisma, driverId);
      expect(stored.find((day) => day.weekday === 5)).toMatchObject({ active: false });
      expect(stored).toHaveLength(5);
      // Saving the unchanged schedule again writes no third audit row.
      await saveWorkScheduleWith(t.prisma, adminId, {
        driverId,
        days: DAYS.map((day) => (day.weekday === 5 ? { ...day, active: false } : day)),
      });
      expect(
        await t.prisma.auditLog.count({ where: { entity: "Driver", entityId: driverId } }),
      ).toBe(2);
    });

    it("refuses a missing driver, a non-driver and an impossible shift", async () => {
      expect(await saveWorkScheduleWith(t.prisma, adminId, schedule("missing"))).toEqual({
        ok: false,
        error: "not_found",
      });
      expect(await saveWorkScheduleWith(t.prisma, adminId, schedule(adminId))).toEqual({
        ok: false,
        error: "not_a_driver",
      });
      expect(
        await saveWorkScheduleWith(t.prisma, adminId, {
          driverId,
          days: [{ weekday: 1, active: true, start: "14:00", end: "06:00" }],
        }),
      ).toEqual({ ok: false, error: "invalid" });
    });

    it("measures the working time of a completed tour and compares it with the plan", async () => {
      const report = await readUtilization(t.prisma, { date: MONDAY, period: "week" });
      const hans = report.drivers.find((driver) => driver.driverId === driverId)!;
      expect(hans.day).toMatchObject({
        actualMinutes: 390,
        plannedMinutes: 380,
        contractMinutes: 480,
        percent: 81,
        planPercent: 103,
        tourCount: 1,
        excludedCount: 0,
      });
      // One weekday switched off earlier: four days of 8 h in the week.
      expect(hans.week.contractMinutes).toBe(4 * 480);
      const tour = hans.tours[0]!;
      expect(tour).toMatchObject({
        plannedMinutes: 380,
        actualMinutes: 390,
        deltaMinutes: 10,
        startSource: "checklist",
        reason: null,
      });
      expect(tour.endedAt).toBe("2026-10-19T11:10:00.000Z");
    });

    it("leaves a tour without timestamps out and reports why", async () => {
      const report = await readUtilization(t.prisma, { date: MONDAY, period: "day" });
      const erika = report.drivers.find((driver) => driver.driverId === otherDriverId)!;
      expect(erika.day).toMatchObject({
        actualMinutes: 0,
        percent: null,
        tourCount: 0,
        excludedCount: 1,
      });
      expect(erika.tours.find((tour) => tour.tourId === unmeasuredTourId)?.reason).toBe("no_start");
      expect(erika.hasSchedule).toBe(false);
      expect(report.withoutSchedule).toBe(0);
    });

    it("warns on the tour page when the plan overruns the shift", async () => {
      // Tuesday: 8 h planned from 07:00 is 15:00 local, the shift ends at 14:00 -> 60 min over.
      const tour = await t.prisma.tour.create({
        data: {
          date: new Date(`${TUESDAY}T00:00:00Z`),
          driverId,
          status: "DRAFT",
          totalDurationS: 8 * 3600,
          depotSnapshot: {},
        },
      });
      const plan = await getTourPlan(t.prisma, TUESDAY, TZ, tour.id);
      expect(plan?.tour?.shiftWarning).toEqual({
        kind: "shift_end",
        weekday: 2,
        plannedReturnAt: "2026-10-20T13:00:00.000Z",
        shiftEnd: "2026-10-20T12:00:00.000Z",
        overrunMinutes: 60,
      });
    });

    it("warns on the tour page when the tour is planned on a non-working day", async () => {
      const tour = await t.prisma.tour.create({
        data: {
          date: new Date(`${SATURDAY}T00:00:00Z`),
          driverId,
          status: "DRAFT",
          totalDurationS: 3600,
          depotSnapshot: {},
        },
      });
      const plan = await getTourPlan(t.prisma, SATURDAY, TZ, tour.id);
      expect(plan?.tour?.shiftWarning).toEqual({ kind: "non_working_day", weekday: 6 });
    });

    it("only warns once a schedule exists", async () => {
      // Hans's measureable tour on Monday has no warning: 6 h from 07:00 is back at 13:00 local.
      const before = await getTourPlan(t.prisma, MONDAY, TZ, measuredTourId);
      expect(before?.tour?.driverId).toBe(driverId);
      expect(before?.tour?.shiftWarning).toBeNull();
      // With his weekdays switched off, every day becomes a non-working day.
      await t.prisma.workSchedule.updateMany({ where: { driverId }, data: { active: false } });
      const after = await getTourPlan(t.prisma, MONDAY, TZ, measuredTourId);
      expect(after?.tour?.shiftWarning).toEqual({ kind: "non_working_day", weekday: 1 });
    });
  },
);
