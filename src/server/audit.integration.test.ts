// @vitest-environment node
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hashSecret } from "./auth/password";
import { LocalHeuristicProvider, setRoutingProviderForTests } from "./routing";
import { FakeStorage } from "./storage/fake";
import { createTestDb, type TestDb } from "./test-db";

const state: { session: { user?: { id: string } } | null; db: TestDb["prisma"] | null } = {
  session: null,
  db: null,
};
vi.mock("next/cache", () => ({
  updateTag: vi.fn(),
  cacheTag: vi.fn(),
  cacheLife: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("./auth/auth", () => ({ auth: async () => state.session }));
vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  getDb: () => state.db,
}));

const orderActions = await import("./order-actions");
const tourActions = await import("./tour-actions");
const { applyStopMutation } = await import("./stop-status");
const { applySyncBatch } = await import("./driver-sync");
const { registerDriverPhoto } = await import("./driver-photos");
const { addCustomerPhoto } = await import("./customer-photos");
const { orderHistoryQuery, tourHistoryQuery } = await import("./audit-queries");
const { recordAudit } = await import("./audit");
const { createOrder, cancelOrder } = await import("./orders");
const { setStorageForTests } = await import("./storage");

const DAY_TEXT = "2099-07-01";
const NOW = new Date("2099-07-01T10:00:00.000Z");
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

describe.skipIf(!process.env.DATABASE_URL)("audit log", { timeout: 90_000 }, () => {
  let t: TestDb;
  let storage: FakeStorage;
  let adminId: string;
  let driverId: string;
  let vehicleId: string;
  let p1: string;
  let p2: string;
  let c1: string;
  let c2: string;
  let seq = 0;

  const asAdmin = () => {
    state.session = { user: { id: adminId } };
  };
  const entries = (where: Record<string, unknown> = {}) =>
    t.prisma.auditLog.findMany({ where, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const actions = async (where: Record<string, unknown> = {}) =>
    (await entries(where)).map((e) => e.action);
  const key = () =>
    `customers/${(++seq).toString(16).padStart(8, "0")}-0000-4000-8000-000000000000.jpg`;
  const uploaded = () => {
    const k = key();
    storage.put(k, new Uint8Array(1234), "image/jpeg");
    return k;
  };
  const driver = () => ({ id: driverId, role: "DRIVER" as const, locale: "de" });

  async function newOrder(
    customerId: string,
    lines: Array<[string, string]>,
    status = "CONFIRMED",
  ) {
    asAdmin();
    const res = await orderActions.createOrderAction({
      customerId,
      deliveryDate: DAY_TEXT,
      status,
      lines: lines.map(([productId, quantity]) => ({ productId, quantity })),
    });
    if (!res.ok) throw new Error(`create failed: ${res.error}`);
    return res.id;
  }
  async function planned() {
    asAdmin();
    const built = await tourActions.generateTourAction({ date: DAY_TEXT });
    if (!built.ok) throw new Error(`generate failed: ${built.error}`);
    return built.tourId;
  }
  async function release(tourId: string) {
    asAdmin();
    await tourActions.assignDriverAction({ tourId, driverId });
    await tourActions.assignVehicleAction({ tourId, vehicleId });
    const tour = await t.prisma.tour.findUniqueOrThrow({ where: { id: tourId } });
    const res = await tourActions.releaseTourAction({
      tourId,
      version: tour.updatedAt.toISOString(),
    });
    if (!res.ok) throw new Error(`release failed: ${res.error}`);
  }

  beforeAll(async () => {
    t = await createTestDb();
    state.db = t.prisma;
    storage = new FakeStorage();
    setStorageForTests(storage);
    const hash = await hashSecret("123456");
    adminId = (
      await t.prisma.user.create({
        data: {
          role: "ADMIN",
          email: "a@example.com",
          passwordHash: hash,
          displayName: "Anna Admin",
        },
      })
    ).id;
    driverId = (
      await t.prisma.user.create({
        data: { role: "DRIVER", username: "drv", passwordHash: hash, displayName: "Dora Driver" },
      })
    ).id;
    vehicleId = (await t.prisma.vehicle.create({ data: { name: "Van", capacityKg: 1000 } })).id;
    const product = (sku: string, de: string) =>
      t.prisma.product
        .create({
          data: {
            sku,
            unit: "PACK",
            weightKgPerUnit: 1,
            name: { de, meta: { source: "de", machine: {}, updatedAt: "x" } },
          },
        })
        .then((p) => p.id);
    p1 = await product("P1", "Spaghetti");
    p2 = await product("P2", "Penne");
  }, 60_000);
  afterAll(async () => {
    await t?.teardown();
  });
  beforeEach(async () => {
    asAdmin();
    setRoutingProviderForTests(new LocalHeuristicProvider());
    await t.prisma.settings.deleteMany();
    await t.prisma.settings.create({ data: { id: 1, ...SETTINGS, depotPinConfirmed: true } });
    await t.prisma.$executeRawUnsafe(`ALTER TABLE "AuditLog" DISABLE TRIGGER USER`);
    await t.prisma.auditLog.deleteMany();
    await t.prisma.$executeRawUnsafe(`ALTER TABLE "AuditLog" ENABLE TRIGGER USER`);
    await t.prisma.stopMutation.deleteMany();
    await t.prisma.stopOrder.deleteMany();
    await t.prisma.stop.deleteMany();
    await t.prisma.tour.deleteMany();
    await t.prisma.orderItem.deleteMany();
    await t.prisma.order.deleteMany();
    await t.prisma.photo.deleteMany();
    await t.prisma.customer.deleteMany();
    const customer = (n: string, lng: number) =>
      t.prisma.customer
        .create({
          data: {
            customerNumber: n,
            name: `Kunde ${n}`,
            street: "Hauptstraße 1",
            postalCode: "1010",
            city: "Wien",
            lat: DEPOT.lat,
            lng: DEPOT.lng + lng,
            pinConfirmed: true,
          },
        })
        .then((c) => c.id);
    c1 = await customer("C1", 0.1);
    c2 = await customer("C2", 0.2);
  });

  describe("orders", () => {
    it("writes one entry per create, with the lines", async () => {
      const id = await newOrder(c1, [[p1, "3"]]);
      const rows = await entries({ entity: "Order", entityId: id });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ actorId: adminId, action: "order.create" });
      expect(rows[0]!.diff).toMatchObject({
        customerId: c1,
        status: "CONFIRMED",
        deliveryDate: DAY_TEXT,
        lines: [{ productId: p1, before: null, after: 300 }],
      });
    });

    it("changing a quantity creates exactly one entry with before and after", async () => {
      const id = await newOrder(c1, [
        [p1, "3"],
        [p2, "1"],
      ]);
      const res = await orderActions.updateOrderAction(id, {
        deliveryDate: DAY_TEXT,
        status: "CONFIRMED",
        lines: [
          { productId: p1, quantity: 9 },
          { productId: p2, quantity: 1 },
        ],
      });
      expect(res.ok).toBe(true);
      const rows = await entries({ entity: "Order", entityId: id, action: "order.update" });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.actorId).toBe(adminId);
      expect(rows[0]!.diff).toEqual({ lines: [{ productId: p1, before: 300, after: 900 }] });
    });

    it("a save that changes nothing writes no entry", async () => {
      const id = await newOrder(c1, [[p1, "2"]]);
      await orderActions.updateOrderAction(id, {
        deliveryDate: DAY_TEXT,
        status: "CONFIRMED",
        lines: [{ productId: p1, quantity: 2 }],
      });
      expect(await actions({ entityId: id })).toEqual(["order.create"]);
    });

    it("records status, date and note changes and added / removed lines", async () => {
      const id = await newOrder(c1, [[p1, "1"]]);
      await orderActions.updateOrderAction(id, {
        deliveryDate: "2099-07-02",
        status: "DRAFT",
        internalNote: "x".repeat(500),
        lines: [{ productId: p2, quantity: 4 }],
      });
      const [, update] = await entries({ entityId: id });
      const diff = update!.diff as Record<string, unknown>;
      expect(diff.status).toEqual({ from: "CONFIRMED", to: "DRAFT" });
      expect(diff.deliveryDate).toEqual({ from: DAY_TEXT, to: "2099-07-02" });
      expect((diff.internalNote as { to: string }).to.length).toBeLessThanOrEqual(200);
      expect(diff.lines).toEqual([
        { productId: p2, before: null, after: 400 },
        { productId: p1, before: 100, after: null },
      ]);
    });

    it("records cancel and duplicate", async () => {
      const id = await newOrder(c1, [[p1, "1"]]);
      const dup = await orderActions.duplicateOrderAction(id, "2099-07-03");
      if (!dup.ok) throw new Error(dup.error);
      await orderActions.cancelOrderAction(id);
      expect(await actions({ entityId: id })).toEqual(["order.create", "order.cancel"]);
      const [copy] = await entries({ entityId: dup.id });
      expect(copy).toMatchObject({ action: "order.duplicate", actorId: adminId });
      expect(copy!.diff).toMatchObject({ sourceOrderId: id, status: "DRAFT" });
    });

    it("is part of the order transaction: a failing hook leaves no entry", async () => {
      const boom = { markOutdatedForDate: async () => Promise.reject(new Error("hook failed")) };
      const before = await t.prisma.auditLog.count();
      await expect(
        createOrder(
          t.prisma,
          adminId,
          { customerId: c1, deliveryDate: DAY_TEXT, lines: [{ productId: p1, quantity: 1 }] },
          new Date("2099-01-01T00:00:00Z"),
          storage,
          boom,
        ),
      ).rejects.toThrow("hook failed");
      const id = await newOrder(c1, [[p1, "1"]]);
      await expect(
        cancelOrder(t.prisma, adminId, id, new Date("2099-01-01T00:00:00Z"), boom),
      ).rejects.toThrow("hook failed");
      expect(await t.prisma.auditLog.count()).toBe(before + 1);
    });
  });

  describe("tours", () => {
    it("records generate, re-optimize, reorder, lock, assign driver and release", async () => {
      await newOrder(c1, [[p1, "1"]]);
      await newOrder(c2, [[p1, "2"]]);
      const tourId = await planned();
      await planned(); // rebuild = re-optimize
      const stops = await t.prisma.stop.findMany({
        where: { tourId },
        orderBy: { sequence: "asc" },
      });
      const reversed = stops.map((s) => s.id).reverse();
      const reorder = await tourActions.reorderStopsAction({ tourId, orderedStopIds: reversed });
      expect(reorder.ok).toBe(true);
      await tourActions.setTourLockedAction({ tourId, locked: true });
      await tourActions.setTourLockedAction({ tourId, locked: true }); // no change: no entry
      await tourActions.setTourLockedAction({ tourId, locked: false });
      await release(tourId);

      const rows = await entries({ entity: "Tour", entityId: tourId });
      expect(rows.map((r) => r.action)).toEqual([
        "tour.generate",
        "tour.reoptimize",
        "tour.reorder",
        "tour.lock",
        "tour.unlock",
        "tour.assign_driver",
        "tour.assign_vehicle",
        "tour.release",
      ]);
      expect(rows.every((r) => r.actorId === adminId)).toBe(true);
      expect(rows[2]!.diff).toMatchObject({
        customerIdsBefore: stops.map((s) => s.customerId),
        customerIdsAfter: stops.map((s) => s.customerId).reverse(),
      });
      expect(rows[5]!.diff).toEqual({ driverId: { from: null, to: driverId } });
      expect(rows[6]!.diff).toEqual({ vehicleId: { from: null, to: vehicleId } });
      expect(rows[7]!.diff).toMatchObject({ stopCount: 2, driverId, vehicleId });
    });

    it("records a re-release with the quantities before and after, and the unchanged variant", async () => {
      const o1 = await newOrder(c1, [[p1, "1"]]);
      await newOrder(c2, [[p1, "2"]]);
      const tourId = await planned();
      await release(tourId);
      await orderActions.updateOrderAction(o1, {
        deliveryDate: DAY_TEXT,
        status: "CONFIRMED",
        lines: [{ productId: p1, quantity: 7 }],
      });
      const tour = await t.prisma.tour.findUniqueOrThrow({ where: { id: tourId } });
      const res = await tourActions.reReleaseTourAction({
        tourId,
        version: tour.updatedAt.toISOString(),
      });
      expect(res.ok).toBe(true);
      const [last] = (await entries({ entity: "Tour", action: "tour.rerelease" })).slice(-1);
      expect(last!.actorId).toBe(adminId);
      expect(last!.diff).toMatchObject({
        changed: true,
        revision: 2,
        stops: [
          { kind: "changed", customerId: c1, items: [{ productId: p1, before: 100, after: 700 }] },
        ],
      });
    });

    it("rejects a failed or refused change without an entry", async () => {
      await newOrder(c1, [[p1, "1"]]);
      const tourId = await planned();
      const before = await t.prisma.auditLog.count();
      expect(await tourActions.assignDriverAction({ tourId, driverId: "nope" })).toEqual({
        ok: false,
        error: "driver_invalid",
      });
      expect((await tourActions.releaseTourAction({ tourId, version: "bad" })).ok).toBe(false);
      expect(await t.prisma.auditLog.count()).toBe(before);
    });
  });

  describe("stop status, photos", () => {
    async function releasedWithStops() {
      const o = await newOrder(c1, [[p1, "1"]]);
      await newOrder(c2, [[p1, "2"]]);
      const tourId = await planned();
      await release(tourId);
      const stops = await t.prisma.stop.findMany({
        where: { tourId },
        orderBy: { sequence: "asc" },
      });
      return { o, tourId, stops };
    }

    it("records delivered, problem and undo by the driver, with the tour status change", async () => {
      const { tourId, stops } = await releasedWithStops();
      const mutation = (stopId: string, extra: Record<string, unknown>, at: Date) =>
        applyStopMutation(
          t.prisma,
          driver(),
          { clientMutationId: randomUUID(), stopId, ...extra },
          at,
        );
      const idProblem = randomUUID();
      const problem = (at: Date) =>
        applyStopMutation(
          t.prisma,
          driver(),
          {
            clientMutationId: idProblem,
            stopId: stops[1]!.id,
            type: "problem",
            reason: "CLOSED",
            note: "Tür zu",
          },
          at,
        );
      expect((await problem(NOW)).ok).toBe(true);
      // A replay of an accepted id changes nothing and writes nothing.
      expect(await problem(new Date(NOW.getTime() + 1000))).toMatchObject({ replayed: true });
      expect(
        (await mutation(stops[1]!.id, { type: "undo" }, new Date(NOW.getTime() + 60_000))).ok,
      ).toBe(true);
      expect(
        (await mutation(stops[0]!.id, { type: "delivered" }, new Date(NOW.getTime() + 90_000))).ok,
      ).toBe(true);

      const rows = await entries({ entity: "Stop" });
      expect(rows.map((r) => r.action)).toEqual(["stop.problem", "stop.undo", "stop.delivered"]);
      expect(rows.every((r) => r.actorId === driverId)).toBe(true);
      expect(rows[0]!.diff).toMatchObject({
        tourId,
        customerId: stops[1]!.customerId,
        status: { from: "PENDING", to: "PROBLEM" },
        reason: "CLOSED",
        note: "Tür zu",
        tourStatus: { from: "RELEASED", to: "IN_PROGRESS" },
        via: "online",
      });
      expect(rows[1]!.diff).toMatchObject({
        status: { from: "PROBLEM", to: "PENDING" },
        previousReason: "CLOSED",
      });
      expect(rows[2]!.diff).toMatchObject({ status: { from: "PENDING", to: "DELIVERED" } });
    });

    it("records offline-synced entries with the time of the tap", async () => {
      const { stops } = await releasedWithStops();
      const tapped = new Date(NOW.getTime() - 20 * 60_000);
      const res = await applySyncBatch(
        t.prisma,
        driver(),
        [
          {
            type: "delivered",
            clientMutationId: randomUUID(),
            stopId: stops[0]!.id,
            createdAt: tapped.toISOString(),
          },
        ],
        NOW,
        { afterApply: () => undefined },
      );
      expect(res.results[0]!.outcome).toBe("applied");
      const [row] = await entries({ entity: "Stop" });
      expect(row).toMatchObject({ action: "stop.delivered", actorId: driverId });
      expect(row!.diff).toMatchObject({ via: "sync", clientCreatedAt: tapped.toISOString() });
    });

    it("records photo add and replace by office and driver", async () => {
      const { tourId, stops } = await releasedWithStops();
      const first = await addCustomerPhoto(t.prisma, storage, adminId, {
        customerId: c1,
        kind: "STORE",
        storageKey: uploaded(),
        width: 800,
        height: 600,
      });
      if (!first.ok) throw new Error(first.error);
      const second = await registerDriverPhoto(
        t.prisma,
        { id: driverId, role: "DRIVER" },
        {
          clientMutationId: randomUUID(),
          stopId: stops.find((s) => s.customerId === c1)!.id,
          kind: "STORE",
          storageKey: uploaded(),
          width: 800,
          height: 600,
        },
        { storage, timezone: "Europe/Vienna" },
        NOW,
      );
      expect(second.outcome).toBe("applied");
      const rows = await entries({ entity: "Customer", entityId: c1 });
      expect(rows.map((r) => [r.action, r.actorId])).toEqual([
        ["photo.add", adminId],
        ["photo.replace", driverId],
      ]);
      expect(rows[1]!.diff).toMatchObject({
        kind: "STORE",
        previousPhotoId: first.photoId,
        via: "driver",
        tourId,
      });
      expect(JSON.stringify(rows.map((r) => r.diff))).not.toMatch(/customers\/|storageKey|http/);
    });
  });

  describe("history reads", () => {
    it("shows the order history with product names, newest first, to admins only", async () => {
      const id = await newOrder(c1, [[p1, "3"]]);
      await orderActions.updateOrderAction(id, {
        deliveryDate: DAY_TEXT,
        status: "CONFIRMED",
        lines: [{ productId: p1, quantity: 9 }],
      });
      const history = await orderHistoryQuery(id);
      expect(history.map((h) => h.action)).toEqual(["order.update", "order.create"]);
      expect(history[0]!.actor).toEqual({ name: "Anna Admin", role: "ADMIN" });
      expect(history[0]!.details).toEqual([
        expect.objectContaining({
          kind: "line",
          sku: "P1",
          productName: expect.objectContaining({ de: "Spaghetti" }),
          before: 300,
          after: 900,
        }),
      ]);

      state.session = null;
      await expect(orderHistoryQuery(id)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
      state.session = { user: { id: driverId } };
      await expect(orderHistoryQuery(id)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(tourHistoryQuery("x")).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("shows the tour history with stop events and the acting driver", async () => {
      await newOrder(c1, [[p1, "1"]]);
      const tourId = await planned();
      await release(tourId);
      const [stop] = await t.prisma.stop.findMany({ where: { tourId } });
      await applyStopMutation(
        t.prisma,
        driver(),
        { clientMutationId: randomUUID(), stopId: stop!.id, type: "delivered" },
        NOW,
      );
      const history = await tourHistoryQuery(tourId);
      expect(history.map((h) => h.action)).toEqual([
        "stop.delivered",
        "tour.release",
        "tour.assign_vehicle",
        "tour.assign_driver",
        "tour.generate",
      ]);
      expect(history[0]!.actor).toEqual({ name: "Dora Driver", role: "DRIVER" });
      expect(history[0]!.details[0]).toMatchObject({ kind: "customer", name: "Kunde C1" });
      expect(history[3]!.details[0]).toMatchObject({
        kind: "field",
        field: "driver",
        before: null,
        after: "Dora Driver",
      });
      expect(history[2]!.details[0]).toMatchObject({
        kind: "field",
        field: "vehicle",
        before: null,
        after: "Van",
      });
      expect(history[1]!.details).toContainEqual(
        expect.objectContaining({ kind: "field", field: "vehicle", after: "Van" }),
      );
    });
  });

  describe("append-only", () => {
    it("refuses update and delete at the database", async () => {
      const id = await newOrder(c1, [[p1, "1"]]);
      const [row] = await entries({ entityId: id });
      await expect(
        t.prisma.auditLog.update({ where: { id: row!.id }, data: { action: "order.cancel" } }),
      ).rejects.toThrow(/append-only/);
      await expect(t.prisma.auditLog.delete({ where: { id: row!.id } })).rejects.toThrow(
        /append-only/,
      );
      await expect(t.prisma.auditLog.deleteMany({})).rejects.toThrow(/append-only/);
    });

    it("scrubs secrets and long text before storing", async () => {
      await recordAudit(t.prisma, {
        actorId: adminId,
        entity: "Order",
        entityId: "o",
        action: "order.update",
        diff: { passwordHash: "x", note: "n".repeat(900), signedUrl: "https://x" },
      });
      const [row] = await entries({ entityId: "o" });
      expect(Object.keys(row!.diff as object)).toEqual(["note"]);
      expect((row!.diff as { note: string }).note.length).toBeLessThanOrEqual(200);
    });
  });
});
