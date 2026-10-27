// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hashSecret } from "./auth/password";
import { createTestDb, type TestDb } from "./test-db";

// NUD-154: a new order belongs to the open tour that already has a stop of its customer; a
// customer on no stop stays in the scope of every open tour until the office picks one.
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

const orderActions = await import("./order-actions");
const { listConfirmedOrdersForDate } = await import("./orders");
const { getTourDiffView, loadReleaseTour } = await import("./tour-rerelease");

const DAY = new Date("2099-07-01T00:00:00Z");
const DAY_TEXT = "2099-07-01";

describe.skipIf(!process.env.DATABASE_URL)("order scope per open tour (NUD-154)", () => {
  let t: TestDb;
  let adminId: string;
  let p1: string;
  let custA: string;
  let custB: string;
  let custC: string;
  let tourA: string;
  let tourB: string;

  const customer = (n: string) =>
    t.prisma.customer
      .create({
        data: {
          customerNumber: n,
          name: `Kunde ${n}`,
          street: "Hauptstraße 1",
          postalCode: "1010",
          city: "Wien",
          lat: 48.2,
          lng: 16.3,
        },
      })
      .then((c) => c.id);
  const seedOrder = (customerId: string, quantity: number) =>
    t.prisma.order
      .create({
        data: {
          customerId,
          deliveryDate: DAY,
          windowFrom: DAY,
          windowTo: DAY,
          status: "CONFIRMED",
          createdById: adminId,
          items: { create: [{ productId: p1, quantity }] },
        },
      })
      .then((o) => o.id);
  /** A tour with one stop of `customerId` carrying `orderId`, as if released. */
  const tourWithStop = async (
    customerId: string,
    orderId: string,
    quantity: number,
    status: "RELEASED" | "COMPLETED" = "RELEASED",
  ) => {
    const tour = await t.prisma.tour.create({
      data: {
        date: DAY,
        status,
        depotSnapshot: { name: "Depot", address: "x", lat: 48.2, lng: 16.3 },
        releaseRevision: 1,
        releasedAt: new Date("2099-06-20T10:00:00Z"),
      },
    });
    const stop = await t.prisma.stop.create({
      data: {
        tourId: tour.id,
        customerId,
        sequence: 1,
        status: status === "COMPLETED" ? "DELIVERED" : "PENDING",
        items: [{ productId: p1, quantity }],
      },
    });
    await t.prisma.stopOrder.create({ data: { stopId: stop.id, orderId } });
    return tour.id;
  };
  const newOrder = async (customerId: string, quantity: number) => {
    state.session = { user: { id: adminId } };
    const result = await orderActions.createOrderAction({
      customerId,
      deliveryDate: DAY_TEXT,
      lines: [{ productId: p1, quantity }],
    });
    if (!result.ok) throw new Error(`create failed: ${result.error}`);
    return result.id;
  };
  const outdated = async (id: string) =>
    (await t.prisma.tour.findUniqueOrThrow({ where: { id } })).isOutdated;
  const diffOf = async (id: string) =>
    getTourDiffView(t.prisma, (await loadReleaseTour(t.prisma, id))!);
  const scopeIds = async (scope: Parameters<typeof listConfirmedOrdersForDate>[2]) =>
    (await listConfirmedOrdersForDate(t.prisma, DAY, scope)).map((o) => o.id).sort();

  beforeAll(async () => {
    t = await createTestDb();
    state.db = t.prisma;
    const hash = await hashSecret("123456");
    adminId = (
      await t.prisma.user.create({
        data: { role: "ADMIN", email: "a@example.com", passwordHash: hash, displayName: "A" },
      })
    ).id;
    p1 = (
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
    await t.prisma.settings.deleteMany();
    await t.prisma.stopMutation.deleteMany();
    await t.prisma.stopOrder.deleteMany();
    await t.prisma.stop.deleteMany();
    await t.prisma.tour.deleteMany();
    await t.prisma.orderItem.deleteMany();
    await t.prisma.order.deleteMany();
    await t.prisma.customer.deleteMany();
    custA = await customer("A");
    custB = await customer("B");
    custC = await customer("C");
    tourA = await tourWithStop(custA, await seedOrder(custA, 2), 2);
    tourB = await tourWithStop(custB, await seedOrder(custB, 3), 3);
  });

  it("flags and diffs only the tour that has a stop of the customer", async () => {
    await newOrder(custB, 5);

    expect(await outdated(tourB)).toBe(true);
    expect(await outdated(tourA)).toBe(false);

    const b = await diffOf(tourB);
    expect(b.added).toEqual([]);
    expect(b.changed).toHaveLength(1);
    expect(b.changed[0]).toMatchObject({ customerId: custB });
    expect(b.changed[0].items).toMatchObject([{ productId: p1, before: 3, after: 8 }]);

    const a = await diffOf(tourA);
    expect(a.added).toEqual([]);
    expect(a.changed).toEqual([]);
    expect(a.removed).toEqual([]);
  });

  it("scopes the unstopped order of a customer on a stop to that tour only", async () => {
    const order = await newOrder(custB, 5);
    expect(await scopeIds({ tourId: tourA })).not.toContain(order);
    expect(await scopeIds({ tourId: tourB })).toContain(order);
    // A tour that does not exist yet and a rebuild of tour A alone do not take it either.
    expect(await scopeIds({ tourId: null })).not.toContain(order);
    expect(await scopeIds({ rebuildTourIds: [tourA] })).not.toContain(order);
    expect(await scopeIds({ rebuildTourIds: [tourA, tourB] })).toContain(order);
    expect(await scopeIds(undefined)).toContain(order);
  });

  it("keeps a customer on no stop in the scope of every open tour and flags all of them", async () => {
    const order = await newOrder(custC, 4);
    expect(await outdated(tourA)).toBe(true);
    expect(await outdated(tourB)).toBe(true);
    expect(await scopeIds({ tourId: tourA })).toContain(order);
    expect(await scopeIds({ tourId: tourB })).toContain(order);
    expect((await diffOf(tourA)).added.map((s) => s.customerId)).toEqual([custC]);
  });

  it("an order of a customer on no stop is a new stop on one tour only once the office put it on a tour", async () => {
    const order = await newOrder(custC, 4);
    // The office releases it on tour A: it is on a stop of A, so B no longer sees it.
    const stop = await t.prisma.stop.create({
      data: {
        tourId: tourA,
        customerId: custC,
        sequence: 2,
        items: [{ productId: p1, quantity: 4 }],
      },
    });
    await t.prisma.stopOrder.create({ data: { stopId: stop.id, orderId: order } });
    expect(await scopeIds({ tourId: tourA })).toContain(order);
    expect(await scopeIds({ tourId: tourB })).not.toContain(order);
    expect((await diffOf(tourB)).added).toEqual([]);
    // A later order of the same customer now follows his stop on A.
    await t.prisma.tour.updateMany({ data: { isOutdated: false } });
    await newOrder(custC, 1);
    expect(await outdated(tourA)).toBe(true);
    expect(await outdated(tourB)).toBe(false);
  });

  it("a stop on a completed tour does not own the customer (follow-up behaviour unchanged)", async () => {
    const done = await tourWithStop(custC, await seedOrder(custC, 1), 1, "COMPLETED");
    const order = await newOrder(custC, 2);
    expect(await outdated(done)).toBe(false);
    expect(await outdated(tourA)).toBe(true);
    expect(await outdated(tourB)).toBe(true);
    expect(await scopeIds({ tourId: tourA })).toContain(order);
    expect(await scopeIds({ tourId: tourB })).toContain(order);
  });

  it("cancelling an order flags only the tour of its customer", async () => {
    const order = await newOrder(custB, 5);
    await t.prisma.tour.updateMany({ data: { isOutdated: false } });
    expect(await orderActions.cancelOrderAction(order)).toMatchObject({ ok: true });
    expect(await outdated(tourB)).toBe(true);
    expect(await outdated(tourA)).toBe(false);
  });
});
