// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { requireDepot } from "@/domain/settings";

import { hashSecret } from "./auth/password";
import { LocalHeuristicProvider, setRoutingProviderForTests } from "./routing";
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
const { getTourPlan, releaseTourWith, reorderStopsWith } = await import("./tour-planning");

const DAY = new Date("2099-07-01T00:00:00Z");
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

describe.skipIf(!process.env.DATABASE_URL)("tour planning", { timeout: 60_000 }, () => {
  let t: TestDb;
  let adminId: string;
  let driverId: string;
  let driver2Id: string;
  let productId: string;
  const provider = new LocalHeuristicProvider();
  const deps = () => ({
    db: t.prisma,
    provider,
    loadSettings: async () => SETTINGS,
  });
  const generate = () =>
    generateTourWith(
      {
        db: t.prisma,
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
  const order = (customerId: string, quantity = "1") =>
    t.prisma.order.create({
      data: {
        customerId,
        deliveryDate: DAY,
        status: "CONFIRMED",
        createdById: adminId,
        items: { create: [{ productId, quantity }] },
      },
    });

  /** Three customers east of the depot; the optimized order is c1, c2, c3. */
  async function buildTour() {
    const ids = [await customer("C1", 0.1), await customer("C2", 0.2), await customer("C3", 0.3)];
    for (const id of ids) await order(id);
    const result = await generate();
    if (!result.ok) throw new Error(`generate failed: ${result.error}`);
    const tour = await t.prisma.tour.findUniqueOrThrow({
      where: { id: result.tourId },
      include: { stops: { orderBy: { sequence: "asc" } } },
    });
    return { tour, stopIds: tour.stops.map((s) => s.id), customerIds: ids };
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
    driver2Id = (
      await t.prisma.user.create({
        data: {
          role: "DRIVER",
          username: "gone",
          passwordHash: hash,
          displayName: "Gone",
          active: false,
        },
      })
    ).id;
    productId = (
      await t.prisma.product.create({
        data: { sku: "P1", unit: "PACK", name: { de: "P1", meta: { source: "de", machine: {} } } },
      })
    ).id;
  }, 60_000);
  afterAll(async () => {
    await t?.teardown();
  });
  beforeEach(async () => {
    state.session = null;
    setRoutingProviderForTests(provider);
    await t.prisma.settings.deleteMany();
    await t.prisma.settings.create({ data: { id: 1, ...SETTINGS, depotPinConfirmed: true } });
    await t.prisma.tour.deleteMany();
    await t.prisma.orderItem.deleteMany();
    await t.prisma.order.deleteMany();
    await t.prisma.photo.deleteMany();
    await t.prisma.customer.deleteMany();
  });

  describe("reorder", () => {
    it("reorders, recomputes legs / ETAs / totals with route() and keeps the lock flag", async () => {
      const { tour, stopIds } = await buildTour();
      const before = tour.stops.map((s) => s.etaAt?.getTime());
      const wanted = [stopIds[2], stopIds[0], stopIds[1]];
      const result = await reorderStopsWith(deps(), { tourId: tour.id, orderedStopIds: wanted });
      expect(result).toEqual({ ok: true, changed: true, approximate: true });

      const after = await t.prisma.tour.findUniqueOrThrow({
        where: { id: tour.id },
        include: { stops: { orderBy: { sequence: "asc" } } },
      });
      expect(after.stops.map((s) => s.id)).toEqual(wanted);
      expect(after.stops.map((s) => s.sequence)).toEqual([1, 2, 3]);
      expect(after.locked).toBe(false);
      expect(after.status).toBe("OPTIMIZED");
      // First stop is now the farthest customer: its ETA is later than before.
      expect(after.stops[0].etaAt!.getTime()).toBeGreaterThan(before[0]!);
      // ETAs strictly increase by leg + 10 min service.
      const etas = after.stops.map((s) => s.etaAt!.getTime());
      expect(etas[1] - etas[0]).toBe((after.stops[1].legDurationS! + 600) * 1000);
      expect(etas[2] - etas[1]).toBe((after.stops[2].legDurationS! + 600) * 1000);
      // Going out to C3 and visiting C1 / C2 on the way back is longer than the optimized order.
      expect(after.totalDurationS!).toBeGreaterThan(0);
      expect(after.totalDistanceM!).toBeGreaterThanOrEqual(tour.totalDistanceM!);
      expect(after.updatedAt.getTime()).toBeGreaterThan(tour.updatedAt.getTime());
    });

    it("an unchanged order is a no-op", async () => {
      const { tour, stopIds } = await buildTour();
      const result = await reorderStopsWith(deps(), { tourId: tour.id, orderedStopIds: stopIds });
      expect(result).toMatchObject({ ok: true, changed: false });
      const after = await t.prisma.tour.findUniqueOrThrow({ where: { id: tour.id } });
      expect(after.updatedAt.getTime()).toBe(tour.updatedAt.getTime());
    });

    it("rejects a list that is not exactly the tour's stops, bad input and unknown tours", async () => {
      const { tour, stopIds } = await buildTour();
      for (const ids of [
        [stopIds[0], stopIds[1]],
        [...stopIds, "x"],
        [stopIds[0], stopIds[0], stopIds[1]],
      ]) {
        expect(await reorderStopsWith(deps(), { tourId: tour.id, orderedStopIds: ids })).toEqual({
          ok: false,
          error: "stops_changed",
        });
      }
      expect(await reorderStopsWith(deps(), { tourId: tour.id })).toEqual({
        ok: false,
        error: "invalid",
      });
      expect(
        await reorderStopsWith(deps(), { tourId: tour.id, orderedStopIds: stopIds, extra: 1 }),
      ).toEqual({ ok: false, error: "invalid" });
      expect(await reorderStopsWith(deps(), { tourId: "nope", orderedStopIds: stopIds })).toEqual({
        ok: false,
        error: "not_found",
      });
      const after = await t.prisma.stop.findMany({
        where: { tourId: tour.id },
        orderBy: { sequence: "asc" },
      });
      expect(after.map((s) => s.id)).toEqual(stopIds);
    });

    it("refuses released tours without changing them", async () => {
      const { tour, stopIds } = await buildTour();
      await t.prisma.tour.update({ where: { id: tour.id }, data: { status: "RELEASED" } });
      const result = await reorderStopsWith(deps(), {
        tourId: tour.id,
        orderedStopIds: [stopIds[2], stopIds[1], stopIds[0]],
      });
      expect(result).toEqual({ ok: false, error: "tour_not_editable" });
      const stops = await t.prisma.stop.findMany({
        where: { tourId: tour.id },
        orderBy: { sequence: "asc" },
      });
      expect(stops.map((s) => s.id)).toEqual(stopIds);
    });
  });

  describe("lock and driver", () => {
    it("toggles the lock and assigns / clears an active driver; inactive drivers are refused", async () => {
      const { tour } = await buildTour();
      state.session = { user: { id: adminId } };
      expect(await actions.setTourLockedAction({ tourId: tour.id, locked: true })).toEqual({
        ok: true,
      });
      expect((await t.prisma.tour.findUniqueOrThrow({ where: { id: tour.id } })).locked).toBe(true);
      expect(await actions.assignDriverAction({ tourId: tour.id, driverId })).toEqual({ ok: true });
      expect((await t.prisma.tour.findUniqueOrThrow({ where: { id: tour.id } })).driverId).toBe(
        driverId,
      );
      expect(await actions.assignDriverAction({ tourId: tour.id, driverId: driver2Id })).toEqual({
        ok: false,
        error: "driver_invalid",
      });
      expect(await actions.assignDriverAction({ tourId: tour.id, driverId: adminId })).toEqual({
        ok: false,
        error: "driver_invalid",
      });
      expect(await actions.assignDriverAction({ tourId: tour.id, driverId: null })).toEqual({
        ok: true,
      });
      expect(
        (await t.prisma.tour.findUniqueOrThrow({ where: { id: tour.id } })).driverId,
      ).toBeNull();
      expect(await actions.setTourLockedAction({ tourId: "nope", locked: true })).toEqual({
        ok: false,
        error: "not_found",
      });
      expect(await actions.setTourLockedAction({ tourId: tour.id, locked: "yes" })).toEqual({
        ok: false,
        error: "invalid",
      });
    });

    it("released tours keep lock and driver", async () => {
      const { tour } = await buildTour();
      await t.prisma.tour.update({
        where: { id: tour.id },
        data: { status: "RELEASED", driverId },
      });
      state.session = { user: { id: adminId } };
      expect(await actions.setTourLockedAction({ tourId: tour.id, locked: true })).toEqual({
        ok: false,
        error: "tour_not_editable",
      });
      expect(await actions.assignDriverAction({ tourId: tour.id, driverId: null })).toEqual({
        ok: false,
        error: "tour_not_editable",
      });
      const after = await t.prisma.tour.findUniqueOrThrow({ where: { id: tour.id } });
      expect(after).toMatchObject({ locked: false, driverId });
    });
  });

  describe("release", () => {
    const version = async (id: string) =>
      (await t.prisma.tour.findUniqueOrThrow({ where: { id } })).updatedAt.toISOString();

    it("requires a driver, then releases with releasedAt", async () => {
      const { tour } = await buildTour();
      expect(
        await releaseTourWith(t.prisma, { tourId: tour.id, version: await version(tour.id) }),
      ).toEqual({
        ok: false,
        error: "driver_required",
      });
      await t.prisma.tour.update({ where: { id: tour.id }, data: { driverId } });
      const now = new Date("2099-06-20T12:00:00Z");
      const result = await releaseTourWith(
        t.prisma,
        { tourId: tour.id, version: await version(tour.id) },
        now,
      );
      expect(result).toEqual({ ok: true, releasedAt: now.toISOString(), stopCount: 3 });
      const after = await t.prisma.tour.findUniqueOrThrow({ where: { id: tour.id } });
      expect(after.status).toBe("RELEASED");
      expect(after.releasedAt?.toISOString()).toBe(now.toISOString());
      // Releasing twice is refused.
      expect(
        await releaseTourWith(t.prisma, { tourId: tour.id, version: await version(tour.id) }),
      ).toEqual({ ok: false, error: "tour_not_editable" });
    });

    it("refuses an inactive driver, an outdated tour, a stale version and an empty tour", async () => {
      const { tour } = await buildTour();
      await t.prisma.tour.update({ where: { id: tour.id }, data: { driverId: driver2Id } });
      expect(
        await releaseTourWith(t.prisma, { tourId: tour.id, version: await version(tour.id) }),
      ).toEqual({
        ok: false,
        error: "driver_invalid",
      });
      await t.prisma.tour.update({ where: { id: tour.id }, data: { driverId, isOutdated: true } });
      expect(
        await releaseTourWith(t.prisma, { tourId: tour.id, version: await version(tour.id) }),
      ).toEqual({
        ok: false,
        error: "outdated",
      });
      const stale = await version(tour.id);
      await t.prisma.tour.update({ where: { id: tour.id }, data: { isOutdated: false } });
      expect(await releaseTourWith(t.prisma, { tourId: tour.id, version: stale })).toEqual({
        ok: false,
        error: "conflict",
      });
      expect(await releaseTourWith(t.prisma, { tourId: tour.id, version: "garbage" })).toEqual({
        ok: false,
        error: "invalid",
      });
      expect((await t.prisma.tour.findUniqueOrThrow({ where: { id: tour.id } })).status).toBe(
        "OPTIMIZED",
      );

      await t.prisma.stop.deleteMany({ where: { tourId: tour.id } });
      expect(
        await releaseTourWith(t.prisma, { tourId: tour.id, version: await version(tour.id) }),
      ).toEqual({
        ok: false,
        error: "no_stops",
      });
    });
  });

  describe("read model", () => {
    it("lists stops with item count and photo flags, warnings, drivers and the tour state", async () => {
      const { tour, customerIds } = await buildTour();
      await t.prisma.photo.create({
        data: {
          customerId: customerIds[0],
          kind: "STORE",
          storageKey: "customers/k.jpg",
          width: 10,
          height: 10,
          bytes: 10,
          uploadedById: adminId,
          isCurrent: true,
        },
      });
      const noPin = await customer("C9", 0.5, { pinConfirmed: false });
      await order(noPin);
      const plan = await getTourPlan(t.prisma, "2099-07-01", "Europe/Vienna");
      expect(plan).toMatchObject({ date: "2099-07-01", confirmedOrderCount: 4 });
      expect(plan?.warnings).toMatchObject([{ code: "PIN_UNCONFIRMED", customerId: noPin }]);
      expect(plan?.drivers.map((d) => d.displayName)).toEqual(["Driver"]);
      expect(plan?.tour).toMatchObject({
        id: tour.id,
        status: "OPTIMIZED",
        approximate: true,
        locked: false,
      });
      expect(plan?.tour?.geometry?.length).toBeGreaterThan(1);
      expect(
        plan?.tour?.stops.map((s) => [
          s.customerNumber,
          s.itemCount,
          s.hasStorePhoto,
          s.hasParkingPhoto,
        ]),
      ).toEqual([
        ["C1", 1, true, false],
        ["C2", 1, false, false],
        ["C3", 1, false, false],
      ]);
      expect(await getTourPlan(t.prisma, "2099-02-30", "Europe/Vienna")).toBeNull();
      const empty = await getTourPlan(t.prisma, "2099-07-02", "Europe/Vienna");
      expect(empty).toMatchObject({ tour: null, confirmedOrderCount: 0 });
    });
  });

  describe("authorization", () => {
    it("rejects anonymous callers and drivers on every mutation and the read, changing nothing", async () => {
      const { tour, stopIds } = await buildTour();
      const calls: Array<() => Promise<unknown>> = [
        () =>
          actions.reorderStopsAction({ tourId: tour.id, orderedStopIds: [...stopIds].reverse() }),
        () => actions.setTourLockedAction({ tourId: tour.id, locked: true }),
        () => actions.assignDriverAction({ tourId: tour.id, driverId }),
        () => actions.releaseTourAction({ tourId: tour.id, version: new Date().toISOString() }),
        async () => (await import("./tour-queries")).tourPlanQuery("2099-07-01"),
      ];
      for (const [session, code] of [
        [null, "UNAUTHENTICATED"],
        [{ user: { id: driverId } }, "FORBIDDEN"],
      ] as const) {
        state.session = session;
        for (const call of calls) await expect(call()).rejects.toMatchObject({ code });
      }
      const after = await t.prisma.tour.findUniqueOrThrow({
        where: { id: tour.id },
        include: { stops: { orderBy: { sequence: "asc" } } },
      });
      expect(after).toMatchObject({ locked: false, driverId: null, status: "OPTIMIZED" });
      expect(after.stops.map((s) => s.id)).toEqual(stopIds);
    });

    it("lets an admin through the real entries end to end", async () => {
      const { tour, stopIds } = await buildTour();
      state.session = { user: { id: adminId } };
      expect(
        await actions.reorderStopsAction({
          tourId: tour.id,
          orderedStopIds: [...stopIds].reverse(),
        }),
      ).toMatchObject({ ok: true, changed: true });
      expect(await actions.assignDriverAction({ tourId: tour.id, driverId })).toEqual({ ok: true });
      const plan = await (await import("./tour-queries")).tourPlanQuery("2099-07-01");
      expect(plan.tour?.stops.map((s) => s.id)).toEqual([...stopIds].reverse());
      const released = await actions.releaseTourAction({
        tourId: tour.id,
        version: plan.tour!.version,
      });
      expect(released).toMatchObject({ ok: true, stopCount: 3 });
    });
  });
});
