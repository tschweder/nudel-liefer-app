// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { requireDepot } from "@/domain/settings";

import { hashSecret } from "./auth/password";
import { LocalHeuristicProvider, RoutingError, setRoutingProviderForTests } from "./routing";
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
const { generateTourAction } = await import("./tour-actions");
const { createTourService } = await import("./tour-service");

const DAY = new Date("2099-07-01T00:00:00Z");
const NOW = new Date("2099-06-20T10:00:00Z");

// Customers on a line east of the depot, so the nearest-neighbour order is obvious.
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

describe.skipIf(!process.env.DATABASE_URL)("tour builder", { timeout: 60_000 }, () => {
  let t: TestDb;
  let adminId: string;
  let driverId: string;
  let p1: string;
  let p2: string;
  const provider = new LocalHeuristicProvider();
  let depotConfirmed = true;
  const deps = () => ({
    db: t.prisma,
    actorId: adminId,
    provider,
    requireDepot: async () => requireDepot({ ...SETTINGS, depotPinConfirmed: depotConfirmed }),
    loadSettings: async () => SETTINGS,
    now: () => NOW,
  });
  const generate = (date: unknown = DAY) => generateTourWith(deps(), date);

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
  const order = (
    customerId: string,
    lines: Array<[string, number]>,
    extra: { status?: "DRAFT" | "CONFIRMED" | "CANCELLED"; date?: Date } = {},
  ) =>
    t.prisma.order
      .create({
        data: {
          customerId,
          deliveryDate: extra.date ?? DAY,
          status: extra.status ?? "CONFIRMED",
          createdById: adminId,
          items: { create: lines.map(([productId, quantity]) => ({ productId, quantity })) },
        },
      })
      .then((o) => o.id);

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
        data: { role: "DRIVER", username: "drv", passwordHash: hash, displayName: "D" },
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
    depotConfirmed = true;
    state.session = null;
    setRoutingProviderForTests(provider);
    await t.prisma.tour.deleteMany();
    await t.prisma.orderItem.deleteMany();
    await t.prisma.order.deleteMany();
    await t.prisma.parkingSpot.deleteMany();
    await t.prisma.customer.deleteMany();
  });

  it("persists an OPTIMIZED tour with sequence, legs, ETAs, geometry, totals and depot snapshot", async () => {
    const far = await customer("C3", 0.3);
    const near = await customer("C1", 0.1);
    const mid = await customer("C2", 0.2);
    await order(far, [[p1, 1]]);
    await order(near, [
      [p1, 3],
      [p2, 1],
    ]);
    await order(near, [[p1, 1]]);
    await order(mid, [[p2, 4]]);

    const result = await generate();
    expect(result).toMatchObject({ ok: true, mode: "created", stopCount: 3, approximate: true });
    if (!result.ok) return;

    const tour = await t.prisma.tour.findUniqueOrThrow({
      where: { id: result.tourId },
      include: { stops: { orderBy: { sequence: "asc" }, include: { orders: true } } },
    });
    expect(tour).toMatchObject({
      status: "OPTIMIZED",
      isOutdated: false,
      locked: false,
      approximate: true,
      depotSnapshot: { name: "Nudelfabrik", lat: DEPOT.lat, lng: DEPOT.lng },
    });
    expect(tour.date.toISOString()).toBe(DAY.toISOString());
    expect(tour.optimizedAt).toEqual(NOW);
    expect((tour.geometry as { type: string }).type).toBe("LineString");
    expect(tour.stops.map((s) => s.customerId)).toEqual([near, mid, far]);
    expect(tour.stops.map((s) => s.sequence)).toEqual([1, 2, 3]);
    expect(tour.stops.map((s) => s.status)).toEqual(["PENDING", "PENDING", "PENDING"]);
    // Two orders of "near" are linked to one stop.
    expect(tour.stops[0].orders).toHaveLength(2);

    // ETAs: 07:00 Vienna (summer) = 05:00Z, + leg 1; then + service 10 min + leg n.
    const departure = new Date("2099-07-01T05:00:00Z").getTime();
    let expected = departure;
    for (const [i, stop] of tour.stops.entries()) {
      expected += (stop.legDurationS ?? 0) * 1000;
      expect(stop.etaAt?.getTime()).toBe(expected);
      expect(stop.legDistanceM).toBeGreaterThan(0);
      if (i < tour.stops.length - 1) expected += 10 * 60 * 1000;
    }
    const legs = tour.stops.reduce((sum, s) => sum + (s.legDurationS ?? 0), 0);
    expect(legs).toBeGreaterThan(0);
    // Total = driving (incl. return leg) + service for 3 stops.
    expect(tour.totalDurationS).toBeGreaterThan(legs + 3 * 600);
    expect(tour.totalDistanceM).toBeGreaterThan(0);
  });

  it("merges quantities per product through the StopOrder links (nothing stored twice)", async () => {
    const c = await customer("C1", 0.1);
    const o1 = await order(c, [
      [p1, 3],
      [p2, 1],
    ]);
    const o2 = await order(c, [[p1, 1]]);
    const result = await generate();
    if (!result.ok) throw new Error("expected ok");
    const stop = await t.prisma.stop.findFirstOrThrow({
      where: { tourId: result.tourId },
      include: { orders: { include: { order: { include: { items: true } } } } },
    });
    expect(stop.orders.map((l) => l.orderId).sort()).toEqual([o1, o2].sort());
    const sum = stop.orders
      .flatMap((l) => l.order.items)
      .filter((i) => i.productId === p1)
      .reduce((s, i) => s + Number(i.quantity), 0);
    expect(sum).toBe(4);
  });

  const parkingSpot = (customerId: string, lat: number, lng: number, extra = {}) =>
    t.prisma.parkingSpot.create({
      data: { customerId, lat, lng, createdById: adminId, ...extra },
    });

  it("routes to the default Parkplatz, else to the address; only 'no location' stays out (NUD-141)", async () => {
    const withSpot = await customer("C1", 0.1);
    const noSpot = await customer("C2", 0.2); // no Parkplatz, never confirmed: still on the tour
    const nothing = await customer("C3", 0.3, { lat: null, lng: null });
    const spotOnly = await customer("C4", 0.4, { lat: null, lng: null });
    await parkingSpot(withSpot, DEPOT.lat + 0.01, DEPOT.lng + 0.11, { sortOrder: 1 });
    await parkingSpot(withSpot, DEPOT.lat + 0.02, DEPOT.lng + 0.12, { sortOrder: 0 }); // default
    await parkingSpot(withSpot, DEPOT.lat + 0.03, DEPOT.lng + 0.13, {
      active: false,
      sortOrder: -1,
    });
    await parkingSpot(spotOnly, DEPOT.lat, DEPOT.lng + 0.41);
    await order(withSpot, [[p1, 1]]);
    await order(noSpot, [[p1, 1]]);
    const o3 = await order(nothing, [[p1, 1]]);
    await order(spotOnly, [[p1, 1]]);

    const optimize = vi.spyOn(provider, "optimize");
    const result = await generate();
    expect(result).toMatchObject({ ok: true, stopCount: 3 });
    if (!result.ok) return;

    const points = new Map(
      optimize.mock.calls[0]![0].stops.map((s) => [s.id, s.location] as const),
    );
    expect(points.get(withSpot)).toEqual({ lat: DEPOT.lat + 0.02, lng: DEPOT.lng + 0.12 });
    expect(points.get(noSpot)).toEqual({ lat: DEPOT.lat, lng: DEPOT.lng + 0.2 });
    expect(points.get(spotOnly)).toEqual({ lat: DEPOT.lat, lng: DEPOT.lng + 0.41 });
    optimize.mockRestore();

    // Only the customer with no location at all is a warning ...
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({
      code: "NO_LOCATION",
      customerId: nothing,
      customerNumber: "C3",
      orderIds: [o3],
    });
    expect(await t.prisma.stop.count({ where: { customerId: nothing } })).toBe(0);
    // ... and the customer routed to the address point carries the non-blocking flag.
    expect(result.parkingMissing.map((w) => w.customerId)).toEqual([noSpot]);
    expect(await t.prisma.stop.count({ where: { customerId: noSpot } })).toBe(1);
  });

  it("puts a freshly imported customer (no confirmation, no Parkplatz) on the tour with the flag", async () => {
    const { commitImport } = await import("./customer-import");
    const { geocodeCustomers } = await import("./customer-pins");
    const { FakeGeocoder } = await import("./geocoder");
    const imported = await commitImport(t.prisma, {
      records: [
        {
          line: 2,
          values: {
            customerNumber: "IMP-1",
            name: "Importiert",
            street: "Neue Gasse 3",
            postalCode: "1020",
            city: "Wien",
          },
        },
      ],
    });
    expect(imported).toMatchObject({ ok: true, created: 1, withoutPin: 1, withoutParking: 1 });
    const row = await t.prisma.customer.findFirstOrThrow({ where: { customerNumber: "IMP-1" } });
    const geocoded = await geocodeCustomers(t.prisma, new FakeGeocoder(), [row.id], {
      wait: async () => {},
    });
    expect(geocoded).toMatchObject({ ok: true, stopped: null });
    await order(row.id, [[p1, 2]]);

    const result = await generate();
    expect(result).toMatchObject({ ok: true, stopCount: 1, warnings: [] });
    if (!result.ok) return;
    expect(result.parkingMissing.map((w) => w.customerId)).toEqual([row.id]);
  });

  it("returns the warnings together with no_stops when nothing is routable", async () => {
    const nothing = await customer("C2", 0.2, { lat: null, lng: null });
    await order(nothing, [[p1, 1]]);
    const result = await generate();
    expect(result).toMatchObject({ ok: false, error: "no_stops" });
    expect(result.warnings).toHaveLength(1);
    expect(await t.prisma.tour.count()).toBe(0);
  });

  it("uses CONFIRMED orders of that day only (no drafts, cancelled or other days)", async () => {
    const c1 = await customer("C1", 0.1);
    const c2 = await customer("C2", 0.2);
    const c3 = await customer("C3", 0.3);
    await order(c1, [[p1, 1]]);
    await order(c2, [[p1, 1]], { status: "DRAFT" });
    await order(c2, [[p1, 1]], { status: "CANCELLED" });
    await order(c3, [[p1, 1]], { date: new Date("2099-07-02T00:00:00Z") });
    const result = await generate();
    expect(result).toMatchObject({ ok: true, stopCount: 1 });
  });

  it("refuses without a confirmed depot and creates nothing", async () => {
    const c = await customer("C1", 0.1);
    await order(c, [[p1, 1]]);
    depotConfirmed = false;
    const result = await generate();
    expect(result).toEqual({ ok: false, error: "depot_not_set", warnings: [] });
    expect(await t.prisma.tour.count()).toBe(0);
  });

  it("rejects invalid and past dates", async () => {
    expect(await generate("nope")).toMatchObject({ ok: false, error: "invalid_date" });
    expect(await generate("2099-02-30")).toMatchObject({ ok: false, error: "invalid_date" });
    expect(await generate("2099-06-19")).toMatchObject({ ok: false, error: "date_in_past" });
    expect(await generate("2099-06-20")).toMatchObject({ ok: false, error: "no_stops" });
  });

  it("explains too many stops with the limit and creates nothing", async () => {
    const rows = Array.from({ length: 51 }, (_, i) => ({
      customerNumber: `M${i}`,
      name: `Many ${i}`,
      street: "S 1",
      postalCode: "1010",
      city: "Wien",
      lat: DEPOT.lat + 0.001 * i,
      lng: DEPOT.lng + 0.001 * i,
    }));
    await t.prisma.customer.createMany({ data: rows });
    const all = await t.prisma.customer.findMany({ select: { id: true } });
    for (const c of all) await order(c.id, [[p1, 1]]);
    const result = await generate();
    expect(result).toMatchObject({ ok: false, error: "too_many_stops", maxStops: 50 });
    expect(await t.prisma.tour.count()).toBe(0);
    // sanity: the provider's own error is what we translated
    await expect(
      provider.optimize({
        depot: DEPOT,
        stops: all.map((c) => ({ id: c.id, location: DEPOT, serviceSeconds: 0 })),
      }),
    ).rejects.toBeInstanceOf(RoutingError);
  });

  describe("re-running", () => {
    it("replaces the stops of an unreleased tour and clears the outdated flag", async () => {
      const c1 = await customer("C1", 0.1);
      const c2 = await customer("C2", 0.2);
      const o1 = await order(c1, [[p1, 1]]);
      const first = await generate();
      if (!first.ok) throw new Error("expected ok");
      const firstStop = await t.prisma.stop.findFirstOrThrow({ where: { tourId: first.tourId } });

      await order(c2, [[p1, 3]]);
      await t.prisma.order.update({ where: { id: o1 }, data: { status: "CANCELLED" } });
      await createTourService(t.prisma).markOutdatedForDate(DAY);
      expect(
        (await t.prisma.tour.findUniqueOrThrow({ where: { id: first.tourId } })).isOutdated,
      ).toBe(true);

      const second = await generate();
      expect(second).toMatchObject({
        ok: true,
        mode: "replaced",
        stopCount: 1,
        tourId: first.tourId,
      });
      const tour = await t.prisma.tour.findUniqueOrThrow({
        where: { id: first.tourId },
        include: { stops: true },
      });
      expect(tour.isOutdated).toBe(false);
      expect(tour.status).toBe("OPTIMIZED");
      expect(tour.stops.map((s) => s.customerId)).toEqual([c2]);
      expect(await t.prisma.stop.findUnique({ where: { id: firstStop.id } })).toBeNull();
      expect(await t.prisma.tour.count()).toBe(1);
    });

    it("keeps the assigned driver and turns a DRAFT tour into OPTIMIZED", async () => {
      const c1 = await customer("C1", 0.1);
      await order(c1, [[p1, 1]]);
      const tour = await t.prisma.tour.create({
        data: { date: DAY, status: "DRAFT", depotSnapshot: {}, driverId },
      });
      const result = await generate();
      expect(result).toMatchObject({ ok: true, mode: "replaced", tourId: tour.id });
      expect(await t.prisma.tour.findUniqueOrThrow({ where: { id: tour.id } })).toMatchObject({
        status: "OPTIMIZED",
        driverId,
      });
    });

    it("drops an unreleased tour's last stops when nothing is left to deliver", async () => {
      const c1 = await customer("C1", 0.1);
      const o = await order(c1, [[p1, 1]]);
      const first = await generate();
      if (!first.ok) throw new Error("expected ok");
      await t.prisma.order.update({ where: { id: o }, data: { status: "CANCELLED" } });
      const again = await generate();
      expect(again).toMatchObject({ ok: true, mode: "replaced", stopCount: 0 });
      const tour = await t.prisma.tour.findUniqueOrThrow({ where: { id: first.tourId } });
      expect(tour).toMatchObject({ totalDurationS: 0, totalDistanceM: 0 });
      expect(await t.prisma.stop.count({ where: { tourId: first.tourId } })).toBe(0);
    });

    it.each(["RELEASED", "IN_PROGRESS", "COMPLETED"] as const)(
      "refuses a %s tour and leaves it untouched",
      async (status) => {
        const c1 = await customer("C1", 0.1);
        await order(c1, [[p1, 1]]);
        const tour = await t.prisma.tour.create({ data: { date: DAY, status, depotSnapshot: {} } });
        expect(await generate()).toMatchObject({ ok: false, error: "tour_not_editable" });
        expect(await t.prisma.stop.count({ where: { tourId: tour.id } })).toBe(0);
        expect((await t.prisma.tour.findUniqueOrThrow({ where: { id: tour.id } })).status).toBe(
          status,
        );
      },
    );

    it("on a LOCKED tour keeps the stop order, appends new customers and removes finished ones", async () => {
      const a = await customer("CA", 0.1);
      const b = await customer("CB", 0.2);
      const c = await customer("CC", 0.3);
      const oa = await order(a, [[p1, 1]]);
      await order(b, [[p1, 1]]);
      await order(c, [[p1, 1]]);
      const first = await generate();
      if (!first.ok) throw new Error("expected ok");
      // Office reorders to c, a, b and locks the tour.
      const seqOf = new Map([
        [c, 1],
        [a, 2],
        [b, 3],
      ]);
      for (const stop of await t.prisma.stop.findMany({ where: { tourId: first.tourId } })) {
        await t.prisma.stop.update({
          where: { id: stop.id },
          data: { sequence: seqOf.get(stop.customerId)! },
        });
      }
      await t.prisma.tour.update({ where: { id: first.tourId }, data: { locked: true } });
      const stopIdsBefore = new Map(
        (await t.prisma.stop.findMany({ where: { tourId: first.tourId } })).map((s) => [
          s.customerId,
          s.id,
        ]),
      );

      // New customer far to the WEST (the optimizer would not put it last), new order for b,
      // and a's only order is cancelled.
      const d = await customer("CD", -0.4);
      await order(d, [[p2, 2]]);
      const ob2 = await order(b, [[p2, 5]]);
      await t.prisma.order.update({ where: { id: oa }, data: { status: "CANCELLED" } });

      const result = await generate();
      expect(result).toMatchObject({
        ok: true,
        mode: "locked_extended",
        addedCustomerIds: [d],
        removedCustomerIds: [a],
      });
      const tour = await t.prisma.tour.findUniqueOrThrow({
        where: { id: first.tourId },
        include: { stops: { orderBy: { sequence: "asc" }, include: { orders: true } } },
      });
      expect(tour.locked).toBe(true);
      expect(tour.status).toBe("OPTIMIZED");
      expect(tour.stops.map((s) => s.customerId)).toEqual([c, b, d]);
      expect(tour.stops.map((s) => s.sequence)).toEqual([1, 2, 3]);
      // Kept stops are the same rows; b picked up its new order.
      expect(tour.stops[0].id).toBe(stopIdsBefore.get(c));
      expect(tour.stops[1].id).toBe(stopIdsBefore.get(b));
      expect(tour.stops[1].orders.map((l) => l.orderId)).toContain(ob2);
      expect(tour.stops[1].orders).toHaveLength(2);
      // ETAs are consistent with the stored legs.
      let t0 = new Date("2099-07-01T05:00:00Z").getTime();
      for (const stop of tour.stops) {
        t0 += (stop.legDurationS ?? 0) * 1000;
        expect(stop.etaAt?.getTime()).toBe(t0);
        t0 += 600_000;
      }
    });
  });

  it("reports a conflict instead of storing a stale tour when orders change while routing", async () => {
    const c1 = await customer("C1", 0.1);
    await order(c1, [[p1, 1]]);
    const slow = {
      optimize: async (input: Parameters<typeof provider.optimize>[0]) => {
        const out = await provider.optimize(input);
        const c2 = await customer("C2", 0.2);
        await order(c2, [[p1, 1]]);
        return out;
      },
      route: provider.route.bind(provider),
    };
    const result = await generateTourWith({ ...deps(), provider: slow }, DAY);
    expect(result).toMatchObject({ ok: false, error: "conflict" });
    expect(await t.prisma.tour.count()).toBe(0);
  });

  describe("generateTourAction", () => {
    it("rejects anonymous callers and drivers", async () => {
      for (const [session, code] of [
        [null, "UNAUTHENTICATED"],
        [{ user: { id: driverId } }, "FORBIDDEN"],
      ] as const) {
        state.session = session;
        await expect(generateTourAction({ date: "2099-07-01" })).rejects.toMatchObject({ code });
      }
      expect(await t.prisma.tour.count()).toBe(0);
    });

    it("validates its input for an admin and builds the tour through the real entry", async () => {
      state.session = { user: { id: adminId } };
      expect(await generateTourAction({})).toMatchObject({ ok: false, error: "invalid_date" });
      expect(await generateTourAction({ date: "2099-07-01", extra: 1 })).toMatchObject({
        ok: false,
        error: "invalid_date",
      });
      expect(await generateTourAction("2099-07-01")).toMatchObject({
        ok: false,
        error: "invalid_date",
      });

      // Settings row is missing in this fresh database -> the depot guard answers.
      expect(await generateTourAction({ date: "2099-07-01" })).toMatchObject({
        ok: false,
        error: "depot_not_set",
      });

      await t.prisma.settings.create({ data: { id: 1, ...SETTINGS, depotPinConfirmed: true } });
      const c1 = await customer("C1", 0.1);
      await order(c1, [[p1, 1]]);
      const result = await generateTourAction({ date: "2099-07-01" });
      expect(result).toMatchObject({ ok: true, mode: "created", stopCount: 1 });
      await t.prisma.settings.deleteMany();
    });
  });
});
