// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { requireDepot } from "@/domain/settings";

import { hashSecret } from "./auth/password";
import { LocalHeuristicProvider, setRoutingProviderForTests } from "./routing";
import { createTestDb, type TestDb } from "./test-db";

// NUD-117: an order that was increased after its stop was delivered is delivered again — the
// difference becomes a confirmed order of the same day and goes onto a follow-up tour.
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
const orderActions = await import("./order-actions");
const { getTourPlan, releaseTourWith } = await import("./tour-planning");
const { getDriverTour } = await import("./tour-driver");
const { createCorrectionDeliveryWith } = await import("./correction-delivery");
const { getLateOrdersView } = await import("./late-orders");
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
  "correction delivery for delivered stops (NUD-117)",
  { timeout: 90_000 },
  () => {
    let t: TestDb;
    let adminId: string;
    let driverId: string;
    let vehicleId: string;
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
    const generate = () => generateTourWith(deps(), DAY);
    const plan = async () => (await getTourPlan(t.prisma, DAY_TEXT, "Europe/Vienna", null))!;

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
    const seedOrder = (customerId: string, quantity: number, productId = p1) =>
      t.prisma.order
        .create({
          data: {
            customerId,
            deliveryDate: DAY,
            windowFrom: DAY,
            windowTo: DAY,
            status: "CONFIRMED",
            createdById: adminId,
            items: { create: [{ productId, quantity }] },
          },
        })
        .then((o) => o.id);
    const release = async (tourId: string) => {
      await t.prisma.tour.update({ where: { id: tourId }, data: { driverId, vehicleId } });
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
    const editOrder = async (
      orderId: string,
      lines: Array<{ productId: string; quantity: number }>,
    ) => {
      state.session = { user: { id: adminId } };
      const result = await orderActions.updateOrderAction(orderId, {
        deliveryDate: DAY_TEXT,
        status: "CONFIRMED",
        lines,
      });
      if (!result.ok) throw new Error(`edit failed: ${result.error}`);
    };
    const stopsOf = (tourId: string) =>
      t.prisma.stop.findMany({
        where: { tourId },
        orderBy: { sequence: "asc" },
        include: { orders: { select: { orderId: true } } },
      });
    const ordersOfDay = () =>
      t.prisma.order.findMany({
        where: { deliveryDate: DAY },
        orderBy: { createdAt: "asc" },
        include: { items: true, stopOrders: true },
      });
    /** Runs the service for the day (or for whatever `rawDate` a test hands in). */
    const correction = (rawDate: unknown = DAY_TEXT) =>
      createCorrectionDeliveryWith(
        {
          db: t.prisma,
          actorId: adminId,
          loadSettings: async () => SETTINGS,
          now: () => NOW,
          createFollowUpTour: (date) => generateTourWith(deps(), date, { followUp: true }),
        },
        rawDate,
      );

    /** One customer (C1, delivered 2 of P1), tour built, released and fully delivered. */
    async function completedDay(quantity = 2) {
      const c1 = await customer("C1", 0.1);
      const o1 = await seedOrder(c1, quantity);
      const built = await generate();
      if (!built.ok) throw new Error(`generate failed: ${built.error}`);
      await release(built.tourId);
      await deliverAll(built.tourId);
      expect((await t.prisma.tour.findUniqueOrThrow({ where: { id: built.tourId } })).status).toBe(
        "COMPLETED",
      );
      return { c1, o1, t1: built.tourId };
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
      vehicleId = (await t.prisma.vehicle.create({ data: { name: "Van", capacityKg: 1000 } })).id;
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

    it("puts exactly the increase of a delivered order on a follow-up tour", async () => {
      const { c1, o1, t1 } = await completedDay(2);
      const completedBefore = await stopsOf(t1);
      await editOrder(o1, [{ productId: p1, quantity: 5 }]);

      // The conflict is reported and the increase is offered as a correction.
      let view = await getLateOrdersView(t.prisma, DAY);
      expect(view.conflicts).toMatchObject([
        { customerId: c1, customerNumber: "C1", items: [{ productId: p1, before: 2, after: 5 }] },
      ]);
      expect(view.corrections).toMatchObject([
        { customerId: c1, customerNumber: "C1", items: [{ productId: p1, before: 0, after: 3 }] },
      ]);
      expect(view.canCreateCorrection).toBe(true);
      expect(view.correctionBlocked).toBe(false);

      const result = await correction();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.customerIds).toEqual([c1]);
      expect(result.orderIds).toHaveLength(1);
      // The order carries the difference only, as a confirmed order of the same day.
      const order = await t.prisma.order.findUniqueOrThrow({
        where: { id: result.orderIds[0]! },
        include: { items: true, stopOrders: true },
      });
      expect(order).toMatchObject({ customerId: c1, status: "CONFIRMED", source: "MANUAL" });
      expect(order.deliveryDate.getTime()).toBe(DAY.getTime());
      expect(order.windowFrom.getTime()).toBe(DAY.getTime());
      expect(order.items).toMatchObject([{ productId: p1, quantity: 3 }]);

      // Its follow-up tour: a second tour of the day with one stop for the difference.
      expect(result.followUp).toMatchObject({ ok: true, mode: "follow_up", stopCount: 1 });
      if (!result.followUp.ok) return;
      expect(result.followUp.tourId).not.toBe(t1);
      const followUpStops = await stopsOf(result.followUp.tourId);
      expect(followUpStops).toHaveLength(1);
      expect(followUpStops[0]).toMatchObject({ customerId: c1, status: "PENDING" });
      expect(followUpStops[0]!.items).toEqual([
        { productId: p1, quantity: order.items[0]!.quantity },
      ]);
      expect(followUpStops[0]!.orders.map((o) => o.orderId)).toEqual(result.orderIds);

      // The completed tour is untouched: same stops, same order links, still COMPLETED.
      expect(await stopsOf(t1)).toEqual(completedBefore);
      expect(await t.prisma.tour.findUniqueOrThrow({ where: { id: t1 } })).toMatchObject({
        status: "COMPLETED",
        isOutdated: false,
      });
      const original = await t.prisma.order.findUniqueOrThrow({ where: { id: o1 } });
      expect(original.status).toBe("CONFIRMED"); // the edited order itself is not split

      // The audit entry names the delivered stop and the difference.
      const audit = await t.prisma.auditLog.findMany({ where: { entityId: result.orderIds[0]! } });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ action: "order.create", entity: "Order", actorId: adminId });
      expect(audit[0]!.diff).toMatchObject({
        customerId: c1,
        status: "CONFIRMED",
        correction: {
          reason: "delivered_stop_increase",
          stopId: completedBefore[0]!.id,
          lines: [{ productId: p1, delivered: 2, ordered: 5 }],
        },
      });

      // The page shows the new tour, and the difference is no longer offered (no double booking).
      const p = await plan();
      expect(p.tours.map((x) => [x.number, x.status])).toEqual([
        [1, "COMPLETED"],
        [2, "OPTIMIZED"],
      ]);
      view = await getLateOrdersView(t.prisma, DAY);
      expect(view.corrections).toEqual([]);
      expect(view.canCreateCorrection).toBe(false);
      expect(view.correctionBlocked).toBe(true); // the conflict stays reported
      expect(view.lateOrders).toEqual([]);
      // A second click on a stale page books nothing: the day already has an open follow-up tour.
      expect(await correction()).toMatchObject({ ok: false, error: "follow_up_not_allowed" });
      expect(await t.prisma.order.count()).toBe(2);
      expect(await t.prisma.tour.count()).toBe(2);
    });

    it("delivers only the increase when other products shrink or are added", async () => {
      const c1 = await customer("C1", 0.1);
      const o1 = await seedOrder(c1, 4);
      const built = await generate();
      if (!built.ok) throw new Error(built.error);
      await release(built.tourId);
      await deliverAll(built.tourId);

      // P1: 4 -> 6 (increase 2), P2: 0 -> 2 (a product added after the delivery).
      await editOrder(o1, [
        { productId: p1, quantity: 6 },
        { productId: p2, quantity: 2 },
      ]);
      const view = await getLateOrdersView(t.prisma, DAY);
      expect(view.conflicts[0]!.items).toMatchObject([
        { productId: p1, before: 4, after: 6 },
        { productId: p2, before: 0, after: 2 },
      ]);
      expect(view.corrections[0]!.items).toMatchObject([
        { productId: p1, before: 0, after: 2 },
        { productId: p2, before: 0, after: 2 },
      ]);

      const result = await correction();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const order = await t.prisma.order.findUniqueOrThrow({
        where: { id: result.orderIds[0]! },
        include: { items: { orderBy: { productId: "asc" } } },
      });
      expect(order.items.map((i) => [i.productId, i.quantity])).toEqual(
        [
          [p1, 2],
          [p2, 2],
        ].sort() as Array<[string, number]>,
      );
    });

    it("never books a decrease or a cancellation, and writes nothing then", async () => {
      const { o1 } = await completedDay(5);
      // Decrease: 5 -> 2.
      await editOrder(o1, [{ productId: p1, quantity: 2 }]);
      let view = await getLateOrdersView(t.prisma, DAY);
      expect(view.conflicts[0]!.items).toMatchObject([{ productId: p1, before: 5, after: 2 }]);
      expect(view.corrections).toEqual([]);
      expect(view.canCreateCorrection).toBe(false);
      expect(view.correctionBlocked).toBe(false); // nothing to explain: there is no increase
      expect(await correction()).toMatchObject({ ok: false, error: "no_corrections" });

      // Cancelled after the delivery: 2 -> 0.
      state.session = { user: { id: adminId } };
      expect((await orderActions.cancelOrderAction(o1)).ok).toBe(true);
      view = await getLateOrdersView(t.prisma, DAY);
      expect(view.conflicts[0]!.items).toMatchObject([{ productId: p1, before: 5, after: 0 }]);
      expect(view.corrections).toEqual([]);
      expect(await correction()).toMatchObject({ ok: false, error: "no_corrections" });

      expect(await t.prisma.order.count()).toBe(1);
      expect(await t.prisma.tour.count()).toBe(1);
    });

    it("refuses while a tour of the day is still open", async () => {
      const c1 = await customer("C1", 0.1);
      const o1 = await seedOrder(c1, 2);
      const built = await generate();
      if (!built.ok) throw new Error(built.error);
      await release(built.tourId);
      // The driver delivered the stop, but the tour is not completed yet (IN_PROGRESS / RELEASED).
      await editOrder(o1, [{ productId: p1, quantity: 4 }]);
      await t.prisma.stop.updateMany({
        where: { tourId: built.tourId },
        data: { status: "DELIVERED", completedAt: new Date("2099-07-01T08:30:00Z") },
      });
      expect(await correction()).toMatchObject({ ok: false, error: "follow_up_not_allowed" });
      expect(await t.prisma.order.count()).toBe(1);
      expect(await t.prisma.tour.count()).toBe(1);
    });

    it("does nothing for a day without a completed tour, a past day or a bad date", async () => {
      const c0 = await customer("C0", 0.05);
      await seedOrder(c0, 2);
      expect(await correction()).toMatchObject({ ok: false, error: "follow_up_not_allowed" });

      await completedDay();
      expect(
        await createCorrectionDeliveryWith(
          {
            db: t.prisma,
            actorId: adminId,
            loadSettings: async () => SETTINGS,
            now: () => new Date("2099-07-02T10:00:00Z"),
            createFollowUpTour: (date) => generateTourWith(deps(), date, { followUp: true }),
          },
          DAY_TEXT,
        ),
      ).toMatchObject({ ok: false, error: "date_in_past" });

      for (const bad of [{}, { date: "not-a-date" }, { date: DAY_TEXT, extra: true }, null, 42]) {
        expect(await correction(bad), JSON.stringify(bad)).toMatchObject({
          ok: false,
          error: "invalid_date",
        });
      }
      // Nothing was created by any of the refused calls: the two seeded orders are all there is.
      expect(await t.prisma.order.count()).toBe(2);
      expect(await t.prisma.tour.count()).toBe(1);
    });

    it("books the difference but reports when no follow-up tour can be planned (no location)", async () => {
      const c8 = await customer("C8", 0.8);
      const o8 = await seedOrder(c8, 2);
      const built = await generate();
      if (!built.ok) throw new Error(built.error);
      await release(built.tourId);
      await deliverAll(built.tourId);
      // The customer loses its point after the delivery and the order is increased.
      await t.prisma.customer.update({ where: { id: c8 }, data: { lat: null, lng: null } });
      await editOrder(o8, [{ productId: p1, quantity: 5 }]);

      const view = await getLateOrdersView(t.prisma, DAY);
      expect(view.corrections).toHaveLength(1);

      const result = await correction();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.followUp).toMatchObject({ ok: false, error: "no_late_orders" });
      if (result.followUp.ok) return;
      expect(result.followUp.warnings).toMatchObject([
        { code: "NO_LOCATION", customerNumber: "C8" },
      ]);
      // The order exists and is reported as a late order that nobody can plan yet.
      const late = await getLateOrdersView(t.prisma, DAY);
      expect(late.lateOrders).toMatchObject([{ customerNumber: "C8", routable: false }]);
      expect(late.corrections).toEqual([]);
      expect(await t.prisma.order.count()).toBe(2);
    });

    it("does not offer the difference while the customer still has an unplanned order", async () => {
      const { c1, o1 } = await completedDay(2);
      await editOrder(o1, [{ productId: p1, quantity: 5 }]);
      // A late order for the same customer, not on any tour yet.
      await seedOrder(c1, 4);

      const view = await getLateOrdersView(t.prisma, DAY);
      expect(view.lateOrders).toMatchObject([{ customerId: c1 }]);
      expect(view.corrections).toEqual([]);
      expect(view.canCreateCorrection).toBe(false);
      expect(view.correctionBlocked).toBe(true);
      expect(await correction()).toMatchObject({ ok: false, error: "no_corrections" });
      expect(await t.prisma.order.count()).toBe(2);
    });

    it("the driver gets a follow-up tour with the difference only", async () => {
      const { o1 } = await completedDay(2);
      await editOrder(o1, [{ productId: p1, quantity: 6 }]);
      const result = await correction();
      if (!result.ok || !result.followUp.ok) throw new Error("correction failed");
      await release(result.followUp.tourId);

      const driverTour = await getDriverTour(t.prisma, driverId, DAY_TEXT);
      expect(driverTour).toMatchObject({ id: result.followUp.tourId, tourNumber: 2, tourCount: 2 });
      expect(driverTour?.stops.map((s) => s.items.map((i) => i.quantity))).toEqual([[4]]);
    });

    describe("createCorrectionDeliveryAction", () => {
      it("rejects anonymous callers and drivers without writing anything", async () => {
        const { o1 } = await completedDay(2);
        await editOrder(o1, [{ productId: p1, quantity: 5 }]);
        const orders = await t.prisma.order.count();
        const tours = await t.prisma.tour.count();
        const audits = await t.prisma.auditLog.count();
        for (const [session, code] of [
          [null, "UNAUTHENTICATED"],
          [{ user: { id: driverId } }, "FORBIDDEN"],
        ] as const) {
          state.session = session;
          await expect(
            orderActions.createCorrectionDeliveryAction({ date: DAY_TEXT }),
          ).rejects.toMatchObject({ code });
        }
        expect(await t.prisma.order.count()).toBe(orders);
        expect(await t.prisma.tour.count()).toBe(tours);
        expect(await t.prisma.auditLog.count()).toBe(audits);
      });

      it("validates its input and delivers through the real entry for an admin", async () => {
        const { o1 } = await completedDay(2);
        await editOrder(o1, [{ productId: p1, quantity: 5 }]);
        state.session = { user: { id: adminId } };
        for (const bad of [{}, { date: DAY_TEXT, extra: 1 }, DAY_TEXT, null]) {
          expect(await orderActions.createCorrectionDeliveryAction(bad)).toMatchObject({
            ok: false,
            error: "invalid_date",
          });
        }
        expect(await t.prisma.order.count()).toBe(1);
        const result = await orderActions.createCorrectionDeliveryAction({ date: DAY_TEXT });
        expect(result).toMatchObject({ ok: true, followUp: { ok: true, mode: "follow_up" } });
        expect(await t.prisma.order.count()).toBe(2);
        expect(await t.prisma.tour.count()).toBe(2);
        // A second click books nothing twice (the day now has an open follow-up tour).
        expect(await orderActions.createCorrectionDeliveryAction({ date: DAY_TEXT })).toMatchObject(
          { ok: false, error: "follow_up_not_allowed" },
        );
        expect(await t.prisma.order.count()).toBe(2);
        expect(await ordersOfDay()).toHaveLength(2);
      });
    });
  },
);
