// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { requireDepot } from "@/domain/settings";

import { hashSecret } from "./auth/password";
import {
  LocalHeuristicProvider,
  type RouteInput,
  type RoutingProvider,
  setRoutingProviderForTests,
} from "./routing";
import { createTestDb, type TestDb } from "./test-db";

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
const { syncTourProgress } = await import("./tour-service");

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
  "tour lifecycle and re-release",
  { timeout: 60_000 },
  () => {
    let t: TestDb;
    let adminId: string;
    let driverId: string;
    let otherDriverId: string;
    let p1: string;
    let p2: string;
    const provider = new LocalHeuristicProvider();
    const deps = (routing: RoutingProvider = provider) => ({
      db: t.prisma,
      actorId: adminId,
      provider: routing,
      loadSettings: async () => SETTINGS,
    });
    const generate = () =>
      generateTourWith(
        {
          db: t.prisma,
          actorId: adminId,
          provider,
          requireDepot: async () => requireDepot({ ...SETTINGS, depotPinConfirmed: true }),
          loadSettings: async () => SETTINGS,
          now: () => NOW,
        },
        DAY,
      );

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
            pinConfirmed: true,
            ...extra,
          },
        })
        .then((c) => c.id);
    const order = (customerId: string, quantity = 1, productId = p1) =>
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
    /** Edits an order through the real action (so the outdated hook runs). */
    const editQuantity = async (orderId: string, quantity: number, productId = p1) => {
      state.session = { user: { id: adminId } };
      const result = await orderActions.updateOrderAction(orderId, {
        deliveryDate: DAY_TEXT,
        status: "CONFIRMED",
        lines: [{ productId, quantity }],
      });
      if (!result.ok) throw new Error(`edit failed: ${result.error}`);
    };

    /** Three customers east of the depot (stops in order c1, c2, c3), released to `driverId`. */
    async function releasedTour() {
      const customerIds = [
        await customer("C1", 0.1),
        await customer("C2", 0.2),
        await customer("C3", 0.3),
      ];
      const orderIds = [];
      for (const id of customerIds) orderIds.push(await order(id, 2));
      const built = await generate();
      if (!built.ok) throw new Error(`generate failed: ${built.error}`);
      await t.prisma.tour.update({ where: { id: built.tourId }, data: { driverId } });
      const version = (await t.prisma.tour.findUniqueOrThrow({ where: { id: built.tourId } }))
        .updatedAt;
      const released = await releaseTourWith(t.prisma, adminId, {
        tourId: built.tourId,
        version: version.toISOString(),
      });
      if (!released.ok) throw new Error(`release failed: ${released.error}`);
      const stops = await t.prisma.stop.findMany({
        where: { tourId: built.tourId },
        orderBy: { sequence: "asc" },
      });
      return { tourId: built.tourId, customerIds, orderIds, stopIds: stops.map((s) => s.id) };
    }
    const loadTour = (tourId: string) =>
      t.prisma.tour.findUniqueOrThrow({
        where: { id: tourId },
        include: { stops: { orderBy: { sequence: "asc" }, include: { orders: true } } },
      });
    const reRelease = async (tourId: string, routing?: RoutingProvider) => {
      const tour = await t.prisma.tour.findUniqueOrThrow({ where: { id: tourId } });
      return reReleaseTourWith(deps(routing), { tourId, version: tour.updatedAt.toISOString() });
    };
    const completeStop = (stopId: string, status: "DELIVERED" | "PROBLEM" = "DELIVERED") =>
      t.prisma.stop.update({
        where: { id: stopId },
        data: {
          status,
          completedAt: new Date("2099-07-01T08:30:00Z"),
          ...(status === "PROBLEM"
            ? {
                problemReason: "CLOSED" as const,
                problemNote: { de: "Zu", meta: { source: "de", machine: {}, updatedAt: "x" } },
              }
            : {}),
        },
      });
    const quantities = async (tourId: string) =>
      (await loadTour(tourId)).stops.map(
        (s) => (s.items as Array<{ quantity: number }>)[0]?.quantity,
      );

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
      otherDriverId = (
        await t.prisma.user.create({
          data: { role: "DRIVER", username: "drv2", passwordHash: hash, displayName: "Other" },
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
      await t.prisma.stopOrder.deleteMany();
      await t.prisma.stop.deleteMany();
      await t.prisma.tour.deleteMany();
      await t.prisma.orderItem.deleteMany();
      await t.prisma.order.deleteMany();
      await t.prisma.customer.deleteMany();
      await t.prisma.user.update({ where: { id: driverId }, data: { active: true } });
    });

    describe("first release", () => {
      it("stores the released quantities per stop and revision 1", async () => {
        const { tourId } = await releasedTour();
        const tour = await loadTour(tourId);
        expect(tour).toMatchObject({ status: "RELEASED", releaseRevision: 1, reReleasedAt: null });
        expect(tour.stops.map((s) => s.items)).toEqual(
          [1, 2, 3].map(() => [{ productId: p1, quantity: 2 }]),
        );
        expect(tour.stops.every((s) => s.changeKind === null)).toBe(true);
      });
    });

    describe("quantity change after release", () => {
      it("flags the tour, shows the diff, keeps the driver on the released numbers until re-release", async () => {
        const { tourId, orderIds, stopIds } = await releasedTour();
        expect((await loadTour(tourId)).isOutdated).toBe(false);

        await editQuantity(orderIds[1], 4);
        expect((await loadTour(tourId)).isOutdated).toBe(true);

        // Admin read model: banner data with the diff.
        const plan = await getTourPlan(t.prisma, DAY_TEXT, "Europe/Vienna");
        expect(plan?.tour?.isOutdated).toBe(true);
        expect(plan?.tour?.diff?.changed).toHaveLength(1);
        expect(plan?.tour?.diff?.changed[0]).toMatchObject({
          stopId: stopIds[1],
          customerNumber: "C2",
          items: [{ productId: p1, sku: "P1", before: 2, after: 4 }],
        });
        expect(plan?.tour?.diff?.added).toEqual([]);
        expect(plan?.tour?.diff?.removed).toEqual([]);

        // Driver data: still the released quantity, no update marker.
        const before = await getDriverTour(t.prisma, driverId, DAY_TEXT);
        expect(before).toMatchObject({ revision: 1, updated: false });
        expect(before?.stops[1].items[0].quantity).toBe(2);

        const result = await reRelease(tourId);
        expect(result).toEqual({
          ok: true,
          changed: true,
          revision: 2,
          added: 0,
          removed: 0,
          changedStops: 1,
          completedChanged: 0,
        });

        const tour = await loadTour(tourId);
        expect(tour).toMatchObject({ isOutdated: false, status: "RELEASED", releaseRevision: 2 });
        expect(tour.reReleasedAt).toBeInstanceOf(Date);
        expect(tour.stops.map((s) => s.id)).toEqual(stopIds);

        const after = await getDriverTour(t.prisma, driverId, DAY_TEXT);
        expect(after).toMatchObject({ revision: 2, updated: true, status: "RELEASED" });
        expect(after?.stops.map((s) => s.items[0].quantity)).toEqual([2, 4, 2]);
        expect(after?.stops.map((s) => s.change)).toEqual([null, "CHANGED", null]);
        // NUD-082: only the changed stop is marked as changed by the office, with the re-release time.
        expect(tour.stops.map((s) => s.adminChangedAt !== null)).toEqual([false, true, false]);
        expect(tour.stops[1].adminChangedAt?.getTime()).toBe(tour.reReleasedAt?.getTime());
        expect(after?.stops[1]).toMatchObject({
          changedInRevision: 2,
          items: [{ quantity: 4, previousQuantity: 2 }],
        });
        expect(after?.stops[0].items[0].previousQuantity).toBeNull();
        // The banner is gone for the office.
        expect((await getTourPlan(t.prisma, DAY_TEXT, "Europe/Vienna"))?.tour?.diff).toBeNull();
      });

      it("adds new customers at the end and removes stops without orders, naming them for the driver", async () => {
        const { tourId, orderIds, stopIds, customerIds } = await releasedTour();
        const newCustomer = await customer("C9", 0.05);
        const newOrder = await order(newCustomer, 4, p2);
        state.session = { user: { id: adminId } };
        await orderActions.cancelOrderAction(orderIds[0]); // stop 1 has nothing left
        await t.prisma.tour.updateMany({ data: { isOutdated: true } }); // direct insert above bypassed the hook

        const result = await reRelease(tourId);
        expect(result).toMatchObject({
          ok: true,
          changed: true,
          added: 1,
          removed: 1,
          changedStops: 0,
        });

        const tour = await loadTour(tourId);
        expect(tour.stops.map((s) => s.sequence)).toEqual([1, 2, 3]);
        expect(tour.stops.map((s) => s.customerId)).toEqual([
          customerIds[1],
          customerIds[2],
          newCustomer,
        ]);
        expect(tour.stops[0].id).toBe(stopIds[1]);
        expect(tour.stops[2]).toMatchObject({ changeKind: "ADDED", changedInRevision: 2 });
        expect(tour.stops[2].adminChangedAt).toBeInstanceOf(Date);
        expect(tour.stops[2].orders.map((o) => o.orderId)).toEqual([newOrder]);
        expect(tour.stops[2].items).toEqual([{ productId: p2, quantity: 4 }]);
        expect(await t.prisma.stop.findUnique({ where: { id: stopIds[0] } })).toBeNull();
        // ETAs follow the new sequence.
        const etas = tour.stops.map((s) => s.etaAt!.getTime());
        expect([...etas].sort((a, b) => a - b)).toEqual(etas);

        const driver = await getDriverTour(t.prisma, driverId, DAY_TEXT);
        expect(driver?.removedCustomers).toEqual([
          expect.objectContaining({ customerId: customerIds[0], customerNumber: "C1" }),
        ]);
        expect(driver?.stops[2]).toMatchObject({ change: "ADDED", changedInRevision: 2 });
      });

      it("a change that is reverted before the re-release only clears the flag", async () => {
        const { tourId, orderIds } = await releasedTour();
        await editQuantity(orderIds[0], 9);
        await editQuantity(orderIds[0], 2);
        expect((await loadTour(tourId)).isOutdated).toBe(true);
        const result = await reRelease(tourId);
        expect(result).toMatchObject({ ok: true, changed: false, revision: 1 });
        const tour = await loadTour(tourId);
        expect(tour).toMatchObject({ isOutdated: false, releaseRevision: 1, reReleasedAt: null });
        expect(tour.stops.every((s) => s.changeKind === null)).toBe(true);
        expect((await getDriverTour(t.prisma, driverId, DAY_TEXT))?.updated).toBe(false);
      });

      it("keeps earlier change markers and counts every re-release as a new revision", async () => {
        const { tourId, orderIds } = await releasedTour();
        await editQuantity(orderIds[0], 3);
        await reRelease(tourId);
        await editQuantity(orderIds[2], 5);
        expect(await reRelease(tourId)).toMatchObject({ ok: true, revision: 3 });
        const driver = await getDriverTour(t.prisma, driverId, DAY_TEXT);
        expect(driver?.stops.map((s) => s.changedInRevision)).toEqual([2, null, 3]);
        expect(driver?.stops.map((s) => s.items[0].quantity)).toEqual([3, 2, 5]);
      });
    });

    describe("completed stops are never reset", () => {
      it("keeps status, completion data, quantities and order links of delivered stops, whatever the orders do", async () => {
        const { tourId, orderIds, stopIds, customerIds } = await releasedTour();
        await completeStop(stopIds[0], "DELIVERED");
        await completeStop(stopIds[1], "PROBLEM");
        await t.prisma.$transaction((tx) => syncTourProgress(tx, tourId));
        expect((await loadTour(tourId)).status).toBe("IN_PROGRESS");
        const frozenBefore = (await loadTour(tourId)).stops.slice(0, 2);

        await editQuantity(orderIds[0], 8); // delivered stop: quantity edited afterwards
        state.session = { user: { id: adminId } };
        await orderActions.cancelOrderAction(orderIds[1]); // problem stop: order cancelled
        await editQuantity(orderIds[2], 6); // open stop
        const again = await order(customerIds[0], 1, p2); // the delivered customer orders more
        await t.prisma.tour.updateMany({ data: { isOutdated: true } });

        const result = await reRelease(tourId);
        expect(result).toMatchObject({
          ok: true,
          changed: true,
          revision: 2,
          added: 1,
          removed: 0,
          changedStops: 1,
          completedChanged: 2,
        });

        const tour = await loadTour(tourId);
        expect(tour.status).toBe("IN_PROGRESS");
        const [s1, s2] = tour.stops;
        for (const [after, before] of [
          [s1, frozenBefore[0]],
          [s2, frozenBefore[1]],
        ] as const) {
          expect(after.id).toBe(before.id);
          expect(after.sequence).toBe(before.sequence);
          expect(after.status).toBe(before.status);
          expect(after.completedAt).toEqual(before.completedAt);
          expect(after.problemReason).toEqual(before.problemReason);
          expect(after.problemNote).toEqual(before.problemNote);
          expect(after.items).toEqual(before.items);
          expect(after.etaAt).toEqual(before.etaAt);
          expect(after.changeKind).toBeNull();
          expect(after.orders.map((o) => o.orderId)).toEqual(before.orders.map((o) => o.orderId));
        }
        expect(s1.status).toBe("DELIVERED");
        expect(s2.status).toBe("PROBLEM");
        // Open stop updated, second visit for the delivered customer appended as a new open stop.
        expect(tour.stops[2]).toMatchObject({
          id: stopIds[2],
          status: "PENDING",
          changeKind: "CHANGED",
        });
        expect(tour.stops[2].items).toEqual([{ productId: p1, quantity: 6 }]);
        expect(tour.stops[3]).toMatchObject({
          customerId: customerIds[0],
          status: "PENDING",
          changeKind: "ADDED",
        });
        expect(tour.stops[3].orders.map((o) => o.orderId)).toEqual([again]);
      });

      it("an edit of only a delivered stop's order is reported but dispatches nothing", async () => {
        const { tourId, orderIds, stopIds } = await releasedTour();
        await completeStop(stopIds[0]);
        await editQuantity(orderIds[0], 7);
        const result = await reRelease(tourId);
        expect(result).toMatchObject({
          ok: true,
          changed: false,
          completedChanged: 1,
          revision: 1,
        });
        const tour = await loadTour(tourId);
        expect(tour.stops[0]).toMatchObject({ status: "DELIVERED" });
        expect(tour.stops[0].items).toEqual([{ productId: p1, quantity: 2 }]);
        expect(tour.isOutdated).toBe(false);
      });

      it("removing every open stop completes the tour; completed stops stay", async () => {
        const { tourId, orderIds, stopIds } = await releasedTour();
        await completeStop(stopIds[0]);
        await t.prisma.$transaction((tx) => syncTourProgress(tx, tourId));
        state.session = { user: { id: adminId } };
        await orderActions.cancelOrderAction(orderIds[1]);
        await orderActions.cancelOrderAction(orderIds[2]);
        expect(await reRelease(tourId)).toMatchObject({ ok: true, removed: 2 });
        const tour = await loadTour(tourId);
        expect(tour.status).toBe("COMPLETED");
        expect(tour.completedAt).toBeInstanceOf(Date);
        expect(tour.stops.map((s) => [s.id, s.status])).toEqual([[stopIds[0], "DELIVERED"]]);
      });

      it("a stop that the driver completes while the re-release is routing is not touched: conflict", async () => {
        const { tourId, orderIds, stopIds } = await releasedTour();
        await editQuantity(orderIds[2], 9);
        const racing: RoutingProvider = {
          optimize: (input) => provider.optimize(input),
          route: async (input: RouteInput) => {
            await completeStop(stopIds[2]);
            return provider.route(input);
          },
        };
        expect(await reRelease(tourId, racing)).toEqual({ ok: false, error: "conflict" });
        const tour = await loadTour(tourId);
        expect(tour.stops[2]).toMatchObject({ status: "DELIVERED" });
        expect(tour.stops[2].items).toEqual([{ productId: p1, quantity: 2 }]);
        expect(tour).toMatchObject({ isOutdated: true, releaseRevision: 1 });
      });
    });

    describe("refusals", () => {
      it("only released tours can be re-released", async () => {
        const id = await customer("C1", 0.1);
        await order(id);
        const built = await generate();
        if (!built.ok) throw new Error("generate");
        expect(await reRelease(built.tourId)).toEqual({ ok: false, error: "not_released" });
        await t.prisma.tour.update({ where: { id: built.tourId }, data: { status: "COMPLETED" } });
        expect(await reRelease(built.tourId)).toEqual({ ok: false, error: "tour_not_editable" });
      });

      it("rejects bad input, unknown tours, stale versions and an inactive driver, changing nothing", async () => {
        const { tourId, orderIds } = await releasedTour();
        await editQuantity(orderIds[0], 5);
        const tour = await t.prisma.tour.findUniqueOrThrow({ where: { id: tourId } });
        const version = tour.updatedAt.toISOString();
        expect(await reReleaseTourWith(deps(), { tourId })).toEqual({
          ok: false,
          error: "invalid",
        });
        expect(await reReleaseTourWith(deps(), { tourId, version: "x" })).toEqual({
          ok: false,
          error: "invalid",
        });
        expect(await reReleaseTourWith(deps(), { tourId, version, extra: 1 })).toEqual({
          ok: false,
          error: "invalid",
        });
        expect(await reReleaseTourWith(deps(), { tourId: "nope", version })).toEqual({
          ok: false,
          error: "not_found",
        });
        expect(
          await reReleaseTourWith(deps(), { tourId, version: "2000-01-01T00:00:00.000Z" }),
        ).toEqual({ ok: false, error: "conflict" });
        await t.prisma.user.update({ where: { id: driverId }, data: { active: false } });
        expect(await reReleaseTourWith(deps(), { tourId, version })).toEqual({
          ok: false,
          error: "driver_invalid",
        });
        expect(await loadTour(tourId)).toMatchObject({ isOutdated: true, releaseRevision: 1 });
      });

      it("the diff the office saw is the one applied: a later order change gives conflict", async () => {
        const { tourId, orderIds } = await releasedTour();
        await editQuantity(orderIds[0], 5);
        const version = (await t.prisma.tour.findUniqueOrThrow({ where: { id: tourId } }))
          .updatedAt;
        const slow: RoutingProvider = {
          optimize: (input) => provider.optimize(input),
          route: async (input) => {
            await editQuantity(orderIds[1], 7); // saved while routing
            return provider.route(input);
          },
        };
        expect(
          await reReleaseTourWith(deps(slow), { tourId, version: version.toISOString() }),
        ).toEqual({ ok: false, error: "conflict" });
        expect(await quantities(tourId)).toEqual([2, 2, 2]);
      });
    });

    describe("authorization", () => {
      it("rejects anonymous callers and drivers, changing nothing", async () => {
        const { tourId, orderIds } = await releasedTour();
        await editQuantity(orderIds[0], 5);
        const version = (await t.prisma.tour.findUniqueOrThrow({ where: { id: tourId } }))
          .updatedAt;
        for (const [session, code] of [
          [null, "UNAUTHENTICATED"],
          [{ user: { id: driverId } }, "FORBIDDEN"],
        ] as const) {
          state.session = session;
          await expect(
            actions.reReleaseTourAction({ tourId, version: version.toISOString() }),
          ).rejects.toMatchObject({ code });
        }
        expect(await loadTour(tourId)).toMatchObject({ isOutdated: true, releaseRevision: 1 });
        expect(await quantities(tourId)).toEqual([2, 2, 2]);
      });

      it("lets an admin re-release through the real action", async () => {
        const { tourId, orderIds } = await releasedTour();
        await editQuantity(orderIds[0], 5);
        const version = (await t.prisma.tour.findUniqueOrThrow({ where: { id: tourId } }))
          .updatedAt;
        state.session = { user: { id: adminId } };
        expect(
          await actions.reReleaseTourAction({ tourId, version: version.toISOString() }),
        ).toMatchObject({ ok: true, changed: true, revision: 2 });
      });
    });

    describe("driver read model", () => {
      it("shows only released tours of that driver", async () => {
        const id = await customer("C1", 0.1);
        await order(id);
        const built = await generate();
        if (!built.ok) throw new Error("generate");
        await t.prisma.tour.update({ where: { id: built.tourId }, data: { driverId } });
        expect(await getDriverTour(t.prisma, driverId, DAY_TEXT)).toBeNull(); // not released yet
        await t.prisma.tour.update({ where: { id: built.tourId }, data: { status: "RELEASED" } });
        expect(await getDriverTour(t.prisma, driverId, DAY_TEXT)).toMatchObject({
          status: "RELEASED",
        });
        expect(await getDriverTour(t.prisma, otherDriverId, DAY_TEXT)).toBeNull();
        expect(await getDriverTour(t.prisma, driverId, "2099-07-02")).toBeNull();
        expect(await getDriverTour(t.prisma, driverId, "not-a-date")).toBeNull();
      });
    });

    describe("syncTourProgress", () => {
      it("RELEASED -> IN_PROGRESS with the first done stop -> COMPLETED with the last", async () => {
        const { tourId, stopIds } = await releasedTour();
        const sync = () => t.prisma.$transaction((tx) => syncTourProgress(tx, tourId, NOW));
        expect(await sync()).toBe("RELEASED");
        await completeStop(stopIds[0]);
        expect(await sync()).toBe("IN_PROGRESS");
        await completeStop(stopIds[1], "PROBLEM");
        expect(await sync()).toBe("IN_PROGRESS");
        await completeStop(stopIds[2]);
        expect(await sync()).toBe("COMPLETED");
        expect(await loadTour(tourId)).toMatchObject({ status: "COMPLETED", completedAt: NOW });
        expect(await sync()).toBe("COMPLETED");
        expect(await t.prisma.$transaction((tx) => syncTourProgress(tx, "nope"))).toBeNull();
      });
    });
  },
);
