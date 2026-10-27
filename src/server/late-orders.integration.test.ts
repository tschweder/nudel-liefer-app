// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { requireDepot } from "@/domain/settings";

import { hashSecret } from "./auth/password";
import { LocalHeuristicProvider, setRoutingProviderForTests } from "./routing";
import { createTestDb, type TestDb } from "./test-db";

// NUD-099: orders confirmed after the tour of their day is COMPLETED, and the follow-up tour.
const state: { session: { user?: { id: string } } | null; db: TestDb["prisma"] | null } = {
  session: null,
  db: null,
};
vi.mock("next/cache", () => ({ updateTag: vi.fn(), cacheTag: vi.fn(), cacheLife: vi.fn() }));
vi.mock("./auth/auth", () => ({ auth: async () => state.session }));
vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  getDb: () => state.db,
}));

const { generateTourWith } = await import("./tour-builder");
const actions = await import("./tour-actions");
const orderActions = await import("./order-actions");
const { getTourPlan, releaseTourWith } = await import("./tour-planning");
const { reReleaseTourWith } = await import("./tour-rerelease");
const { getDriverTour } = await import("./tour-driver");
const { getTodayProgress } = await import("./tour-progress");
const { orderOverviewQuery } = await import("./order-queries");
const { tourPlanQuery } = await import("./tour-queries");
const { tourHistoryQuery } = await import("./audit-queries");
const { applyStopMutation } = await import("./stop-status");

const DAY = new Date("2099-07-01T00:00:00Z");
const DAY_TEXT = "2099-07-01";
const NOW = new Date("2099-06-20T10:00:00Z");
const DEPOT = { lat: 48.2, lng: 16.3 };
const SETTINGS = {
  depotName: "Nudelfabrik",
  depotAddress: "Graben 1, 1010 Wien",
  depotLat: DEPOT.lat,
  depotLng: DEPOT.lng,
  timezone: "Europe/Vienna",
  departureTime: "07:00",
  serviceMinutesPerStop: 10,
  deliveryWeekdays: [1, 2, 3, 4, 5],
};

describe.skipIf(!process.env.DATABASE_URL)(
  "late orders and follow-up tour",
  { timeout: 90_000 },
  () => {
    let t: TestDb;
    let adminId: string;
    let driverId: string;
    let p1: string;
    let p2: string;
    const provider = new LocalHeuristicProvider();
    const deps = () => ({
      db: t.prisma,
      actorId: adminId,
      provider,
      requireDepot: async () => requireDepot({ ...SETTINGS, depotPinConfirmed: true }),
      loadSettings: async () => SETTINGS,
      now: () => NOW,
    });
    const reDeps = () => ({
      db: t.prisma,
      actorId: adminId,
      provider,
      loadSettings: async () => SETTINGS,
    });
    const generate = () => generateTourWith(deps(), DAY);
    const followUp = () => generateTourWith(deps(), DAY, { followUp: true });
    const plan = async (tourId?: string) =>
      (await getTourPlan(t.prisma, DAY_TEXT, "Europe/Vienna", tourId))!;

    const customer = (n: string, lngOffset: number, extra: Record<string, unknown> = {}) =>
      t.prisma.customer
        .create({
          data: {
            customerNumber: n,
            name: `Kunde ${n}`,
            street: "Hauptstraße 1",
            postalCode: "1010",
            city: "Wien",
            lat: DEPOT.lat,
            lng: DEPOT.lng + lngOffset,
            ...extra,
          },
        })
        .then((c) => c.id);
    /** A confirmed order created through the real action (so the outdated hook runs). */
    const lateOrder = async (customerId: string, quantity: number, productId = p1) => {
      state.session = { user: { id: adminId } };
      const result = await orderActions.createOrderAction({
        customerId,
        deliveryDate: DAY_TEXT,
        lines: [{ productId, quantity }],
      });
      if (!result.ok) throw new Error(`create failed: ${result.error}`);
      return result.id;
    };
    const seedOrder = (customerId: string, quantity: number, productId = p1) =>
      t.prisma.order
        .create({
          data: {
            customerId,
            deliveryDate: DAY,
            status: "CONFIRMED",
            createdById: adminId,
            items: { create: [{ productId, quantity }] },
          },
        })
        .then((o) => o.id);
    const release = async (tourId: string) => {
      await t.prisma.tour.update({ where: { id: tourId }, data: { driverId } });
      const version = (await t.prisma.tour.findUniqueOrThrow({ where: { id: tourId } })).updatedAt;
      const released = await releaseTourWith(t.prisma, adminId, {
        tourId,
        version: version.toISOString(),
      });
      if (!released.ok) throw new Error(`release failed: ${released.error}`);
    };
    const deliverAll = async (tourId: string) => {
      const stops = await t.prisma.stop.findMany({
        where: { tourId },
        orderBy: { sequence: "asc" },
      });
      for (const stop of stops) {
        const result = await applyStopMutation(
          t.prisma,
          { id: driverId, role: "DRIVER", locale: "de" },
          { clientMutationId: crypto.randomUUID(), stopId: stop.id, type: "delivered" },
          new Date("2099-07-01T08:30:00Z"),
        );
        if (!result.ok) throw new Error(`deliver failed: ${result.error}`);
      }
    };
    const tourRow = (id: string) => t.prisma.tour.findUniqueOrThrow({ where: { id } });

    /** Day with two customers (C1, C2), one order each, tour built, released and fully delivered. */
    async function completedDay() {
      const c1 = await customer("C1", 0.1);
      const c2 = await customer("C2", 0.2);
      const o1 = await seedOrder(c1, 2);
      const o2 = await seedOrder(c2, 4);
      const built = await generate();
      if (!built.ok) throw new Error(`generate failed: ${built.error}`);
      await release(built.tourId);
      await deliverAll(built.tourId);
      expect((await tourRow(built.tourId)).status).toBe("COMPLETED");
      return { c1, c2, o1, o2, t1: built.tourId };
    }

    beforeAll(async () => {
      t = await createTestDb();
      state.db = t.prisma;
      const hash = await hashSecret("123456");
      adminId = (
        await t.prisma.user.create({
          data: { role: "ADMIN", email: "a@example.com", passwordHash: hash, displayName: "A" },
        })
      ).id;
      driverId = (
        await t.prisma.user.create({
          data: { role: "DRIVER", username: "drv", passwordHash: hash, displayName: "Driver" },
        })
      ).id;
      const product = (sku: string) =>
        t.prisma.product
          .create({
            data: {
              sku,
              unit: "PACK",
              weightKgPerUnit: 1,
              name: { de: sku, meta: { source: "de", machine: {} } },
            },
          })
          .then((p) => p.id);
      p1 = await product("P1");
      p2 = await product("P2");
    }, 60_000);
    afterAll(async () => {
      await t?.teardown();
    });
    beforeEach(async () => {
      state.session = { user: { id: adminId } };
      setRoutingProviderForTests(provider);
      await t.prisma.settings.deleteMany();
      await t.prisma.settings.create({ data: { id: 1, ...SETTINGS, depotPinConfirmed: true } });
      await t.prisma.stopMutation.deleteMany();
      await t.prisma.stopOrder.deleteMany();
      await t.prisma.stop.deleteMany();
      await t.prisma.tour.deleteMany();
      await t.prisma.orderItem.deleteMany();
      await t.prisma.order.deleteMany();
      await t.prisma.customer.deleteMany();
    });

    it("flags nothing on the completed tour but reports the late orders to the office", async () => {
      const { c1, t1 } = await completedDay();
      const c3 = await customer("C3", 0.3);
      await lateOrder(c1, 3); // a delivered customer orders again
      await lateOrder(c3, 5, p2); // a customer that was not on the tour

      // markOutdatedForDate leaves the completed tour alone (history).
      expect(await tourRow(t1)).toMatchObject({ status: "COMPLETED", isOutdated: false });

      const p = await plan();
      expect(p.tours).toMatchObject([{ id: t1, number: 1, status: "COMPLETED", stopCount: 2 }]);
      expect(p.tour?.id).toBe(t1);
      expect(p.late.lateOrderCount).toBe(2);
      expect(p.late.canCreateFollowUp).toBe(true);
      expect(p.late.lateOrders.map((o) => [o.customerNumber, o.routable])).toEqual([
        ["C1", true],
        ["C3", true],
      ]);
      expect(p.late.lateOrders[0].items).toMatchObject([{ productId: p1, before: 0, after: 3 }]);
      expect(p.late.conflicts).toEqual([]);
      // The ordinary builder still refuses a completed tour; it does not create the follow-up itself.
      expect(await generate()).toMatchObject({ ok: false, error: "tour_not_editable" });
      expect(await t.prisma.tour.count()).toBe(1);
    });

    it("the overview marks late orders and the dashboard counts them", async () => {
      const { c1, o1 } = await completedDay();
      const late = await lateOrder(c1, 3);
      const overview = await orderOverviewQuery({ from: DAY_TEXT, to: DAY_TEXT });
      const flags = Object.fromEntries(overview.rows.map((r) => [r.id, r.late === true]));
      expect(flags).toMatchObject({ [late]: true, [o1]: false });

      const today = await getTodayProgress(t.prisma, {
        now: new Date("2099-07-01T09:00:00Z"),
        timezone: "Europe/Vienna",
      });
      expect(today.lateOrderCount).toBe(1);
      expect(today.tour?.status).toBe("COMPLETED");
    });

    it("creates a follow-up tour with only the unlinked orders and leaves the completed tour untouched", async () => {
      const { c1, o1, o2, t1 } = await completedDay();
      const c3 = await customer("C3", 0.3);
      const late1 = await lateOrder(c1, 3);
      const late3 = await lateOrder(c3, 5, p2);
      const stopsBefore = await t.prisma.stop.findMany({
        where: { tourId: t1 },
        orderBy: { sequence: "asc" },
        include: { orders: true },
      });

      const result = await followUp();
      expect(result).toMatchObject({ ok: true, mode: "follow_up", stopCount: 2, warnings: [] });
      if (!result.ok) return;
      expect(result.tourId).not.toBe(t1);

      // The completed tour: same status, stops, links and snapshots.
      expect(await tourRow(t1)).toMatchObject({ status: "COMPLETED", isOutdated: false });
      const stopsAfter = await t.prisma.stop.findMany({
        where: { tourId: t1 },
        orderBy: { sequence: "asc" },
        include: { orders: true },
      });
      expect(stopsAfter).toEqual(stopsBefore);

      // The follow-up tour: a second Tour row for the same date, OPTIMIZED, only the late orders.
      const t2 = await t.prisma.tour.findUniqueOrThrow({
        where: { id: result.tourId },
        include: { stops: { include: { orders: true }, orderBy: { sequence: "asc" } } },
      });
      expect(t2).toMatchObject({ status: "OPTIMIZED", driverId: null });
      expect(t2.date.getTime()).toBe(DAY.getTime());
      const linked = t2.stops.flatMap((s) => s.orders.map((o) => o.orderId)).sort();
      expect(linked).toEqual([late1, late3].sort());
      expect(linked).not.toContain(o1);
      expect(linked).not.toContain(o2);
      const c1Stop = t2.stops.find((s) => s.customerId === c1)!;
      expect(c1Stop.items).toEqual([{ productId: p1, quantity: 3 }]); // 3, not 2 + 3
      expect(t2.stops).toHaveLength(2);

      // Both tours of the day are listed, the one that needs work is selected; no late orders left.
      const p = await plan();
      expect(p.tours.map((x) => [x.number, x.status])).toEqual([
        [1, "COMPLETED"],
        [2, "OPTIMIZED"],
      ]);
      expect(p.tour?.id).toBe(t2.id);
      expect(p.late.lateOrderCount).toBe(0);
      expect((await plan(t1)).tour?.id).toBe(t1);
      expect((await plan("does-not-exist")).tour?.id).toBe(t2.id);
      expect((await tourPlanQuery(DAY_TEXT, t1)).tour?.id).toBe(t1);

      // The audit entry is written in the same transaction and names the tours and orders.
      const audit = await t.prisma.auditLog.findMany({
        where: { entityId: t2.id },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ action: "tour.followup", actorId: adminId });
      expect(audit[0].diff).toMatchObject({
        mode: "follow_up",
        followUpOfTourIds: [t1],
        stopCount: 2,
      });
      expect((audit[0].diff as { orderIds: string[] }).orderIds.sort()).toEqual(
        [late1, late3].sort(),
      );

      // The tour's timeline shows the follow-up entry with its stop count.
      const history = await tourHistoryQuery(t2.id);
      expect(history.map((e) => e.action)).toContain("tour.followup");
      expect(history.find((e) => e.action === "tour.followup")?.details).toContainEqual({
        kind: "fact",
        key: "stopCount",
        value: 2,
      });

      // A second click does not create another tour (an unfinished tour exists now).
      expect(await followUp()).toMatchObject({ ok: false, error: "follow_up_not_allowed" });
      expect(await t.prisma.tour.count()).toBe(2);
    });

    it("a late order after the follow-up tour exists flags only the follow-up tour and the rebuild keeps the scopes apart", async () => {
      const { c1, t1 } = await completedDay();
      const c3 = await customer("C3", 0.3);
      const c4 = await customer("C4", 0.4);
      await lateOrder(c1, 3);
      await lateOrder(c3, 5);
      const first = await followUp();
      if (!first.ok) throw new Error(first.error);

      await lateOrder(c4, 1);
      expect(await tourRow(t1)).toMatchObject({ isOutdated: false });
      expect(await tourRow(first.tourId)).toMatchObject({ isOutdated: true });

      // generateTour rebuilds the NEWEST tour with the orders that are not on a completed stop.
      const rebuilt = await generate();
      expect(rebuilt).toMatchObject({
        ok: true,
        mode: "replaced",
        stopCount: 3,
        tourId: first.tourId,
      });
      const stops = await t.prisma.stop.findMany({
        where: { tourId: first.tourId },
        include: { customer: true },
      });
      expect(stops.map((s) => s.customer.customerNumber).sort()).toEqual(["C1", "C3", "C4"]);
      expect(stops.find((s) => s.customerId === c1)!.items).toEqual([
        { productId: p1, quantity: 3 },
      ]);
      expect(await t.prisma.tour.count()).toBe(2);
      expect(await tourRow(t1)).toMatchObject({ status: "COMPLETED" });
    });

    it("the driver sees the follow-up tour once it is released and the completed one before", async () => {
      const { c1, t1 } = await completedDay();
      await lateOrder(c1, 3);
      const result = await followUp();
      if (!result.ok) throw new Error(result.error);

      // Not released yet: the driver still has the finished tour.
      expect((await getDriverTour(t.prisma, driverId, DAY_TEXT))?.id).toBe(t1);

      await release(result.tourId);
      const driverTour = await getDriverTour(t.prisma, driverId, DAY_TEXT);
      expect(driverTour).toMatchObject({ id: result.tourId, status: "RELEASED", updated: false });
      expect(driverTour?.stops.map((s) => s.items.map((i) => i.quantity))).toEqual([[3]]);

      // Delivering the follow-up stop completes that tour; the driver's choice is stable.
      await deliverAll(result.tourId);
      expect((await getDriverTour(t.prisma, driverId, DAY_TEXT))?.id).toBe(result.tourId);
      expect((await tourRow(result.tourId)).status).toBe("COMPLETED");

      // Another late order: a third tour is possible (every tour of the day is completed again).
      const c5 = await customer("C5", 0.5);
      await lateOrder(c5, 1);
      expect((await plan()).late.canCreateFollowUp).toBe(true);
      const third = await followUp();
      expect(third).toMatchObject({ ok: true, mode: "follow_up", stopCount: 1 });
      expect((await plan()).tours.map((x) => x.number)).toEqual([1, 2, 3]);
    });

    it("re-releasing the follow-up tour only diffs its own orders", async () => {
      const { c1, o1 } = await completedDay();
      const late = await lateOrder(c1, 3);
      const c3 = await customer("C3", 0.3);
      await lateOrder(c3, 5);
      const result = await followUp();
      if (!result.ok) throw new Error(result.error);
      await release(result.tourId);

      // Edit the late order: the follow-up tour is outdated; the diff names that one change only.
      state.session = { user: { id: adminId } };
      const edited = await orderActions.updateOrderAction(late, {
        deliveryDate: DAY_TEXT,
        status: "CONFIRMED",
        lines: [{ productId: p1, quantity: 4 }],
      });
      expect(edited.ok).toBe(true);
      const p = await plan();
      expect(p.tour?.id).toBe(result.tourId);
      expect(p.tour?.isOutdated).toBe(true);
      expect(p.tour?.diff?.added).toEqual([]);
      expect(p.tour?.diff?.removed).toEqual([]);
      expect(
        p.tour?.diff?.changed.map((s) => [s.customerNumber, s.items[0].before, s.items[0].after]),
      ).toEqual([["C1", 3, 4]]);

      const tour = await tourRow(result.tourId);
      const rr = await reReleaseTourWith(reDeps(), {
        tourId: result.tourId,
        version: tour.updatedAt.toISOString(),
      });
      expect(rr).toMatchObject({ ok: true, changed: true, changedStops: 1, added: 0, removed: 0 });
      // The order of the completed tour is still not on the follow-up tour.
      const links = await t.prisma.stopOrder.findMany({
        where: { stop: { tourId: result.tourId } },
      });
      expect(links.map((l) => l.orderId)).not.toContain(o1);
    });

    it("reports edits to orders of delivered stops as conflicts and does not re-dispatch them", async () => {
      const { c1, o1, t1 } = await completedDay();
      state.session = { user: { id: adminId } };
      const edited = await orderActions.updateOrderAction(o1, {
        deliveryDate: DAY_TEXT,
        status: "CONFIRMED",
        lines: [{ productId: p1, quantity: 6 }],
      });
      expect(edited.ok).toBe(true);
      expect(await tourRow(t1)).toMatchObject({ status: "COMPLETED", isOutdated: false });

      const p = await plan();
      expect(p.late.lateOrderCount).toBe(0);
      expect(p.late.canCreateFollowUp).toBe(false);
      expect(p.late.conflicts).toHaveLength(1);
      expect(p.late.conflicts[0]).toMatchObject({ customerId: c1, customerNumber: "C1" });
      expect(p.late.conflicts[0].items).toMatchObject([{ productId: p1, before: 2, after: 6 }]);
      // Nothing to follow up: the changed quantity is not an unlinked order.
      expect(await followUp()).toMatchObject({ ok: false, error: "no_late_orders" });
      expect(await t.prisma.tour.count()).toBe(1);

      // A cancelled order after delivery is a conflict too (delivered 2, now 0).
      const cancelled = await orderActions.cancelOrderAction(o1);
      expect(cancelled.ok).toBe(true);
      expect((await plan()).late.conflicts[0].items).toMatchObject([
        { productId: p1, before: 2, after: 0 },
      ]);
    });

    it("reports nothing for days that are not finished, and refuses a follow-up there", async () => {
      // No tour at all.
      const c1 = await customer("C1", 0.1);
      await seedOrder(c1, 2);
      expect((await plan()).late).toMatchObject({ lateOrderCount: 0, canCreateFollowUp: false });
      expect(await followUp()).toMatchObject({ ok: false, error: "follow_up_not_allowed" });

      // An open tour: the ordinary outdated flag and rebuild handle new orders.
      const built = await generate();
      if (!built.ok) throw new Error(built.error);
      const c2 = await customer("C2", 0.2);
      await lateOrder(c2, 1);
      expect((await plan()).late).toMatchObject({ lateOrderCount: 0, canCreateFollowUp: false });
      expect(await tourRow(built.tourId)).toMatchObject({ isOutdated: true });
      expect(await followUp()).toMatchObject({ ok: false, error: "follow_up_not_allowed" });
      expect(await t.prisma.tour.count()).toBe(1);

      // The rebuild includes the new order as before (single tour, behaviour unchanged).
      expect(await generate()).toMatchObject({ ok: true, mode: "replaced", stopCount: 2 });

      // A released tour with a new order: still the re-release path, no late order.
      await release(built.tourId);
      const c3 = await customer("C3", 0.3);
      await lateOrder(c3, 1);
      const p = await plan();
      expect(p.late.lateOrderCount).toBe(0);
      expect(p.tour?.diff?.added.map((s) => s.customerNumber)).toEqual(["C3"]);
    });

    it("keeps customers with no location at all out of the follow-up tour and says so", async () => {
      const { t1 } = await completedDay();
      const noPin = await customer("C8", 0.8, { lat: null, lng: null });
      await lateOrder(noPin, 2);
      let p = await plan();
      expect(p.late.lateOrders).toMatchObject([{ customerNumber: "C8", routable: false }]);
      expect(p.late.canCreateFollowUp).toBe(false);
      // Only an unroutable customer: nothing to build, reported with the warning, nothing created.
      expect(await followUp()).toMatchObject({
        ok: false,
        error: "no_late_orders",
        warnings: [{ code: "NO_LOCATION", customerNumber: "C8" }],
      });
      expect(await t.prisma.tour.count()).toBe(1);

      const c9 = await customer("C9", 0.9);
      await lateOrder(c9, 1);
      expect(await followUp()).toMatchObject({
        ok: true,
        stopCount: 1,
        warnings: [{ customerNumber: "C8" }],
      });
      p = await plan();
      expect(p.tours).toHaveLength(2);
      expect(await tourRow(t1)).toMatchObject({ status: "COMPLETED" });
    });

    it("refuses a follow-up for a past day", async () => {
      const past = await generateTourWith(
        { ...deps(), now: () => new Date("2099-07-02T10:00:00Z") },
        DAY,
        {
          followUp: true,
        },
      );
      expect(past).toMatchObject({ ok: false, error: "date_in_past" });
    });

    describe("createFollowUpTourAction", () => {
      it("rejects anonymous callers and drivers without writing anything", async () => {
        await completedDay();
        await lateOrder(await customer("C3", 0.3), 1);
        const tours = await t.prisma.tour.count();
        const audits = await t.prisma.auditLog.count();
        for (const [session, code] of [
          [null, "UNAUTHENTICATED"],
          [{ user: { id: driverId } }, "FORBIDDEN"],
        ] as const) {
          state.session = session;
          await expect(actions.createFollowUpTourAction({ date: DAY_TEXT })).rejects.toMatchObject({
            code,
          });
        }
        expect(await t.prisma.tour.count()).toBe(tours);
        expect(await t.prisma.auditLog.count()).toBe(audits);
      });

      it("validates its input and builds the follow-up through the real entry for an admin", async () => {
        await completedDay();
        await lateOrder(await customer("C3", 0.3), 1);
        state.session = { user: { id: adminId } };
        for (const bad of [{}, { date: DAY_TEXT, extra: 1 }, DAY_TEXT, null]) {
          expect(await actions.createFollowUpTourAction(bad)).toMatchObject({
            ok: false,
            error: "invalid_date",
          });
        }
        expect(await t.prisma.tour.count()).toBe(1);
        expect(await actions.createFollowUpTourAction({ date: DAY_TEXT })).toMatchObject({
          ok: true,
          mode: "follow_up",
          stopCount: 1,
        });
        expect(await t.prisma.tour.count()).toBe(2);
      });

      it("tourPlanQuery stays admin-only", async () => {
        for (const [session, code] of [
          [null, "UNAUTHENTICATED"],
          [{ user: { id: driverId } }, "FORBIDDEN"],
        ] as const) {
          state.session = session;
          await expect(tourPlanQuery(DAY_TEXT, "x")).rejects.toMatchObject({ code });
        }
      });
    });
  },
);
