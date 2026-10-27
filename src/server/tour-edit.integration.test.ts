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
const { createEmptyTourWith, editTourWith, MAX_TOURS_PER_DAY } = await import("./tour-edit");
const { getDriverTour } = await import("./tour-driver");
const { getTourPlan } = await import("./tour-planning");
const actions = await import("./tour-actions");

const DAY = new Date("2099-07-01T00:00:00Z");
const DAY_ISO = "2099-07-01";
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

describe.skipIf(!process.env.DATABASE_URL)("tour edit (Bearbeiten)", { timeout: 60_000 }, () => {
  let t: TestDb;
  let adminId: string;
  let driverId: string;
  let driver2Id: string;
  let inactiveId: string;
  let productId: string;
  const provider = new LocalHeuristicProvider();
  const deps = () => ({
    db: t.prisma,
    actorId: adminId,
    provider,
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
  const addEmptyTour = async () => {
    const result = await createEmptyTourWith(
      {
        db: t.prisma,
        actorId: adminId,
        requireDepot: async () => requireDepot({ ...SETTINGS, depotPinConfirmed: true }),
        loadSettings: async () => SETTINGS,
      },
      { date: DAY_ISO },
      NOW,
    );
    if (!result.ok) throw new Error(`createEmptyTour failed: ${result.error}`);
    return result.tourId;
  };

  const customer = (n: string, lngOffset: number) =>
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
        },
      })
      .then((c) => c.id);
  const order = (customerId: string, quantity = 1) =>
    t.prisma.order.create({
      data: {
        customerId,
        deliveryDate: DAY,
        status: "CONFIRMED",
        createdById: adminId,
        items: { create: [{ productId, quantity }] },
      },
    });

  const load = (tourId: string) =>
    t.prisma.tour.findUniqueOrThrow({
      where: { id: tourId },
      include: { stops: { orderBy: { sequence: "asc" } } },
    });

  /** Three customers; the optimized order is C1, C2, C3. */
  async function buildTour() {
    const ids = [await customer("C1", 0.1), await customer("C2", 0.2), await customer("C3", 0.3)];
    for (const id of ids) await order(id);
    const result = await generate();
    if (!result.ok) throw new Error(`generate failed: ${result.error}`);
    const tour = await load(result.tourId);
    return { tour, stopIds: tour.stops.map((s) => s.id), customerIds: ids };
  }

  const release = (tourId: string, driver: string = driverId) =>
    t.prisma.tour.update({
      where: { id: tourId },
      data: { status: "RELEASED", releasedAt: NOW, releaseRevision: 1, driverId: driver },
    });

  const edit = (
    tour: { id: string; updatedAt: Date; driverId: string | null },
    over: Record<string, unknown> = {},
  ) =>
    editTourWith(
      deps(),
      {
        tourId: tour.id,
        version: tour.updatedAt.toISOString(),
        driverId: tour.driverId,
        orderedStopIds: [],
        moves: [],
        ...over,
      },
      NOW,
    );

  const audit = (tourId: string) =>
    t.prisma.auditLog.findMany({
      where: { entity: "Tour", entityId: tourId },
      orderBy: { createdAt: "asc" },
    });

  beforeAll(async () => {
    t = await createTestDb();
    state.db = t.prisma;
    const hash = await hashSecret("123456");
    const user = (data: Record<string, unknown>) =>
      t.prisma.user.create({ data: { passwordHash: hash, ...data } as never }).then((u) => u.id);
    adminId = await user({ role: "ADMIN", email: "a@example.com", displayName: "A" });
    driverId = await user({ role: "DRIVER", username: "drv", displayName: "Anna" });
    driver2Id = await user({ role: "DRIVER", username: "drv2", displayName: "Bela" });
    inactiveId = await user({
      role: "DRIVER",
      username: "gone",
      displayName: "Gone",
      active: false,
    });
    productId = (
      await t.prisma.product.create({
        data: {
          sku: "P1",
          unit: "PACK",
          weightKgPerUnit: 1,
          name: { de: "P1", meta: { source: "de", machine: {} } },
        },
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
    await t.prisma.parkingSpot.deleteMany();
    await t.prisma.customer.deleteMany();
  });

  describe("unreleased tour", () => {
    it("changes the driver and the stop order, recomputes ETAs and audits both", async () => {
      const { tour, stopIds } = await buildTour();
      const wanted = [stopIds[2], stopIds[0], stopIds[1]];
      const result = await edit(tour, { driverId, orderedStopIds: wanted });
      expect(result).toEqual({ ok: true, changed: true, revision: 0, moved: 0 });

      const after = await load(tour.id);
      expect(after.driverId).toBe(driverId);
      expect(after.stops.map((s) => s.id)).toEqual(wanted);
      expect(after.stops.map((s) => s.sequence)).toEqual([1, 2, 3]);
      expect(after).toMatchObject({ status: "OPTIMIZED", releaseRevision: 0, reReleasedAt: null });
      expect(after.stops[0].etaAt!.getTime()).toBeGreaterThan(tour.stops[0].etaAt!.getTime());
      expect((await audit(tour.id)).map((a) => a.action)).toEqual([
        "tour.generate",
        "tour.assign_driver",
        "tour.reorder",
      ]);
    });

    it("an unchanged form is a no-op", async () => {
      const { tour, stopIds } = await buildTour();
      const result = await edit(tour, { orderedStopIds: stopIds });
      expect(result).toMatchObject({ ok: true, changed: false });
      expect((await load(tour.id)).updatedAt.getTime()).toBe(tour.updatedAt.getTime());
    });

    it("moves a stop to another tour of the day, appended at its end", async () => {
      const { tour, stopIds, customerIds } = await buildTour();
      const otherId = await addEmptyTour();
      const result = await edit(tour, {
        orderedStopIds: [stopIds[0], stopIds[2]],
        moves: [{ stopId: stopIds[1], targetTourId: otherId }],
      });
      expect(result).toMatchObject({ ok: true, changed: true, moved: 1 });

      const source = await load(tour.id);
      const target = await load(otherId);
      expect(source.stops.map((s) => s.id)).toEqual([stopIds[0], stopIds[2]]);
      expect(source.stops.map((s) => s.sequence)).toEqual([1, 2]);
      expect(target.stops.map((s) => s.id)).toEqual([stopIds[1]]);
      expect(target.stops[0]).toMatchObject({
        customerId: customerIds[1],
        sequence: 1,
        changeKind: null,
        status: "PENDING",
      });
      expect(target.stops[0].etaAt).not.toBeNull();
      expect(target.totalDurationS).toBeGreaterThan(0);
      expect(target.geometry).not.toBeNull();
      // The order stays linked to the moved stop; each tour's own orders are consistent.
      const links = await t.prisma.stopOrder.count({ where: { stopId: stopIds[1] } });
      expect(links).toBe(1);

      expect((await audit(tour.id)).map((a) => a.action)).toContain("tour.move_stop");
      expect((await audit(otherId)).map((a) => a.action)).toEqual([
        "tour.create_empty",
        "tour.move_stop",
      ]);
      const plan = await getTourPlan(t.prisma, DAY_ISO, "Europe/Vienna", tour.id);
      expect(plan!.tours.map((x) => [x.number, x.stopCount])).toEqual([
        [1, 2],
        [2, 1],
      ]);
      // Nothing is flagged outdated: the orders of the moved stop belong to the other tour now.
      expect(source.isOutdated).toBe(false);
    });

    it("moving all stops out leaves an empty tour without route data", async () => {
      const { tour, stopIds } = await buildTour();
      const otherId = await addEmptyTour();
      const result = await edit(tour, {
        orderedStopIds: [],
        moves: stopIds.map((stopId) => ({ stopId, targetTourId: otherId })),
      });
      expect(result).toMatchObject({ ok: true, moved: 3 });
      const source = await load(tour.id);
      expect(source.stops).toHaveLength(0);
      expect(source).toMatchObject({ geometry: null, totalDurationS: null, totalDistanceM: null });
      expect((await load(otherId)).stops.map((s) => s.id)).toEqual(stopIds);
    });
  });

  describe("released tour (tour was updated path)", () => {
    it("a reorder bumps the revision and the driver sees the new order and the update flag", async () => {
      const { tour, stopIds } = await buildTour();
      await release(tour.id);
      const released = await load(tour.id);
      const wanted = [stopIds[1], stopIds[2], stopIds[0]];
      const result = await edit(released, { orderedStopIds: wanted });
      expect(result).toEqual({ ok: true, changed: true, revision: 2, moved: 0 });

      const after = await load(tour.id);
      expect(after).toMatchObject({ status: "RELEASED", releaseRevision: 2 });
      expect(after.reReleasedAt).not.toBeNull();
      const view = await getDriverTour(t.prisma, driverId, DAY_ISO);
      expect(view).toMatchObject({ revision: 2, updated: true });
      expect(view!.stops.map((s) => s.id)).toEqual(wanted);
      // Quantities are untouched.
      expect(view!.stops.every((s) => s.items[0].quantity === 1)).toBe(true);
      expect((await audit(tour.id)).at(-1)).toMatchObject({ action: "tour.reorder" });
    });

    it("a driver change hands the tour over; clearing the driver is refused", async () => {
      const { tour, stopIds } = await buildTour();
      await release(tour.id);
      const released = await load(tour.id);
      expect(await edit(released, { driverId: null, orderedStopIds: stopIds })).toEqual({
        ok: false,
        error: "driver_required",
      });
      const result = await edit(released, { driverId: driver2Id, orderedStopIds: stopIds });
      expect(result).toMatchObject({ ok: true, changed: true, revision: 2 });
      expect(await getDriverTour(t.prisma, driverId, DAY_ISO)).toBeNull();
      expect(await getDriverTour(t.prisma, driver2Id, DAY_ISO)).toMatchObject({
        revision: 2,
        updated: true,
      });
    });

    it("moving a stop between two released tours marks it ADDED there and removed here", async () => {
      const { tour, stopIds, customerIds } = await buildTour();
      const otherId = await addEmptyTour();
      await release(tour.id);
      await release(otherId, driver2Id);
      const released = await load(tour.id);
      const result = await edit(released, {
        orderedStopIds: [stopIds[0], stopIds[2]],
        moves: [{ stopId: stopIds[1], targetTourId: otherId }],
      });
      expect(result).toMatchObject({ ok: true, revision: 2, moved: 1 });

      const source = await getDriverTour(t.prisma, driverId, DAY_ISO);
      expect(source!.stops.map((s) => s.id)).toEqual([stopIds[0], stopIds[2]]);
      expect(source!.removedCustomers.map((c) => c.customerId)).toEqual([customerIds[1]]);
      const target = await getDriverTour(t.prisma, driver2Id, DAY_ISO);
      expect(target).toMatchObject({ revision: 2, updated: true });
      expect(target!.stops).toHaveLength(1);
      expect(target!.stops[0]).toMatchObject({
        id: stopIds[1],
        change: "ADDED",
        changedInRevision: 2,
        status: "PENDING",
      });
      expect(target!.stops[0].items[0].quantity).toBe(1);
    });

    it("completed stops keep their slot and cannot be moved; the rest can be reordered", async () => {
      const { tour, stopIds } = await buildTour();
      await release(tour.id);
      await t.prisma.stop.update({
        where: { id: stopIds[0] },
        data: { status: "DELIVERED", completedAt: NOW },
      });
      await t.prisma.tour.update({ where: { id: tour.id }, data: { status: "IN_PROGRESS" } });
      const running = await load(tour.id);
      const otherId = await addEmptyTour();

      expect(
        await edit(running, {
          orderedStopIds: [stopIds[1], stopIds[2]],
          moves: [{ stopId: stopIds[0], targetTourId: otherId }],
        }),
      ).toEqual({ ok: false, error: "stop_locked" });
      // The completed stop is not part of the requested order of open stops.
      expect(await edit(running, { orderedStopIds: [stopIds[0], stopIds[2], stopIds[1]] })).toEqual(
        { ok: false, error: "stops_changed" },
      );

      const result = await edit(running, { orderedStopIds: [stopIds[2], stopIds[1]] });
      expect(result).toMatchObject({ ok: true, changed: true });
      const after = await load(tour.id);
      expect(after.status).toBe("IN_PROGRESS");
      expect(after.stops.map((s) => s.id)).toEqual([stopIds[0], stopIds[2], stopIds[1]]);
      expect(after.stops[0]).toMatchObject({ status: "DELIVERED", sequence: 1 });
      expect(after.stops[0].completedAt!.getTime()).toBe(NOW.getTime());
    });

    it("moving the last open stop away completes the tour", async () => {
      const { tour, stopIds } = await buildTour();
      await release(tour.id);
      await t.prisma.stop.updateMany({
        where: { id: { in: [stopIds[0], stopIds[1]] } },
        data: { status: "DELIVERED", completedAt: NOW },
      });
      await t.prisma.tour.update({ where: { id: tour.id }, data: { status: "IN_PROGRESS" } });
      const otherId = await addEmptyTour();
      const result = await edit(await load(tour.id), {
        moves: [{ stopId: stopIds[2], targetTourId: otherId }],
      });
      expect(result).toMatchObject({ ok: true, moved: 1 });
      const after = await load(tour.id);
      expect(after.status).toBe("COMPLETED");
      expect(after.completedAt).not.toBeNull();
    });
  });

  describe("refusals", () => {
    it("a completed tour, a stale version, bad input and unknown tours", async () => {
      const { tour, stopIds } = await buildTour();
      const stale = { ...tour, updatedAt: new Date(tour.updatedAt.getTime() - 5000) };
      expect(await edit(stale, { orderedStopIds: stopIds })).toEqual({
        ok: false,
        error: "conflict",
      });
      expect(await editTourWith(deps(), { tourId: tour.id })).toEqual({
        ok: false,
        error: "invalid",
      });
      expect(await editTourWith(deps(), { tourId: tour.id, extra: 1 })).toEqual({
        ok: false,
        error: "invalid",
      });
      expect(await edit({ id: "nope", updatedAt: NOW, driverId: null })).toEqual({
        ok: false,
        error: "not_found",
      });
      await t.prisma.tour.update({ where: { id: tour.id }, data: { status: "COMPLETED" } });
      expect(await edit(await load(tour.id), { orderedStopIds: stopIds })).toEqual({
        ok: false,
        error: "tour_not_editable",
      });
    });

    it("an inactive or unknown driver", async () => {
      const { tour, stopIds } = await buildTour();
      for (const bad of [inactiveId, "nope", adminId]) {
        expect(await edit(tour, { driverId: bad, orderedStopIds: stopIds })).toEqual({
          ok: false,
          error: "driver_invalid",
        });
      }
    });

    it("order lists that are not the open stops of the tour", async () => {
      const { tour, stopIds } = await buildTour();
      for (const ids of [
        [stopIds[0], stopIds[1]],
        [...stopIds, "x"],
        [stopIds[0], stopIds[0], stopIds[1]],
      ]) {
        expect(await edit(tour, { orderedStopIds: ids })).toEqual({
          ok: false,
          error: "stops_changed",
        });
      }
    });

    it("targets: same tour, other day, completed tour, customer already there", async () => {
      const { tour, stopIds, customerIds } = await buildTour();
      const rest = [stopIds[0], stopIds[2]];
      const move = (targetTourId: string) =>
        edit(tour, { orderedStopIds: rest, moves: [{ stopId: stopIds[1], targetTourId }] });

      expect(await move(tour.id)).toEqual({ ok: false, error: "target_invalid" });
      expect(await move("nope")).toEqual({ ok: false, error: "target_invalid" });

      const otherDay = await t.prisma.tour.create({
        data: {
          date: new Date("2099-07-02T00:00:00Z"),
          status: "OPTIMIZED",
          depotSnapshot: { name: "d", address: "a", ...DEPOT },
        },
      });
      expect(await move(otherDay.id)).toEqual({ ok: false, error: "target_invalid" });

      const done = await addEmptyTour();
      await t.prisma.tour.update({ where: { id: done }, data: { status: "COMPLETED" } });
      expect(await move(done)).toEqual({ ok: false, error: "target_invalid" });

      const busy = await addEmptyTour();
      await t.prisma.stop.create({
        data: { tourId: busy, customerId: customerIds[1], sequence: 1 },
      });
      expect(await move(busy)).toEqual({ ok: false, error: "customer_in_target" });
      // Nothing was written by any refusal.
      expect((await load(tour.id)).stops.map((s) => s.id)).toEqual(stopIds);
    });
  });

  describe("empty tour (+ Tour)", () => {
    const create = (rawDate: unknown, now = NOW) =>
      createEmptyTourWith(
        {
          db: t.prisma,
          actorId: adminId,
          requireDepot: async () => requireDepot({ ...SETTINGS, depotPinConfirmed: true }),
          loadSettings: async () => SETTINGS,
        },
        rawDate,
        now,
      );

    it("creates an OPTIMIZED tour without stops and driver, releasable only once it has both", async () => {
      const id = await addEmptyTour();
      const tour = await load(id);
      expect(tour).toMatchObject({ status: "OPTIMIZED", driverId: null, isOutdated: false });
      expect(tour.stops).toHaveLength(0);
      expect(tour.depotSnapshot).toMatchObject({ lat: DEPOT.lat, lng: DEPOT.lng });
      const plan = await getTourPlan(t.prisma, DAY_ISO, "Europe/Vienna", id);
      expect(plan!.tours).toEqual([
        { id, number: 1, status: "OPTIMIZED", stopCount: 0, driverName: null },
      ]);
    });

    it("refuses bad dates, past days and more than the daily maximum", async () => {
      expect(await create({ date: "nonsense" })).toEqual({ ok: false, error: "invalid_date" });
      expect(await create({})).toEqual({ ok: false, error: "invalid_date" });
      expect(await create({ date: "2099-06-19" })).toEqual({ ok: false, error: "date_in_past" });
      for (let i = 0; i < MAX_TOURS_PER_DAY; i++)
        expect((await create({ date: DAY_ISO })).ok).toBe(true);
      expect(await create({ date: DAY_ISO })).toEqual({ ok: false, error: "too_many_tours" });
    });
  });

  describe("server actions", () => {
    it("edit and create work for the admin and are refused for a driver", async () => {
      const { tour, stopIds } = await buildTour();
      state.session = { user: { id: driverId } };
      await expect(
        actions.editTourAction({ tourId: tour.id, version: "x", driverId: null }),
      ).rejects.toThrow();
      await expect(actions.createEmptyTourAction({ date: DAY_ISO })).rejects.toThrow();

      state.session = { user: { id: adminId } };
      const result = await actions.editTourAction({
        tourId: tour.id,
        version: tour.updatedAt.toISOString(),
        driverId,
        orderedStopIds: stopIds,
        moves: [],
      });
      expect(result).toMatchObject({ ok: true, changed: true });
    });
  });
});
