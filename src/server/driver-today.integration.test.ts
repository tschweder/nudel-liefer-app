// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { AuthorizationError } from "./auth/actor";
import { hashSecret } from "./auth/password";
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

const { driverTodayQuery, getDriverToday, todayInTimezone } = await import("./driver-today");

// 22:30 UTC on 1 July is already 2 July in Vienna: "today" is the factory's calendar day.
const NOW = new Date("2099-07-01T22:30:00Z");
const OPTIONS = { now: NOW, timezone: "Europe/Vienna", serviceMinutesPerStop: 10 };
const text = (de: string, hans: string) => ({
  de,
  "zh-Hans": hans,
  meta: { source: "de", machine: {}, updatedAt: "2099-01-01T00:00:00Z" },
});

describe.skipIf(!process.env.DATABASE_URL)("driver today screen data", { timeout: 60_000 }, () => {
  let t: TestDb;
  let driverId: string;
  let otherDriverId: string;
  let adminId: string;
  let inactiveId: string;
  let tourId: string;
  let stopIds: string[];

  beforeAll(async () => {
    t = await createTestDb();
    state.db = t.prisma;
    const hash = await hashSecret("123456");
    const user = (data: Record<string, unknown>) =>
      t.prisma.user.create({ data: { passwordHash: hash, ...data } as never }).then((u) => u.id);
    adminId = await user({ role: "ADMIN", email: "a@example.com", displayName: "A" });
    driverId = await user({ role: "DRIVER", username: "drv", displayName: "Driver" });
    otherDriverId = await user({ role: "DRIVER", username: "drv2", displayName: "Other" });
    inactiveId = await user({
      role: "DRIVER",
      username: "drv3",
      displayName: "Gone",
      active: false,
    });

    const spaghetti = await t.prisma.product.create({
      data: { sku: "SPAG", unit: "KG", weightKgPerUnit: 1, name: text("Spaghetti", "意大利面") },
    });
    const penne = await t.prisma.product.create({
      data: { sku: "PENN", unit: "PACK", weightKgPerUnit: 1, name: text("Penne", "笔管面") },
    });
    const customers = [];
    for (const n of [1, 2, 3]) {
      customers.push(
        await t.prisma.customer.create({
          data: {
            customerNumber: `K${n}`,
            name: `Trattoria ${n}`,
            street: "Hauptstraße 1",
            postalCode: "1010",
            city: "Wien",
            lat: 48.2 + n / 100,
            lng: 16.3,
            pinConfirmed: true,
          },
        }),
      );
    }
    const mkTour = (date: string, owner: string) =>
      t.prisma.tour.create({
        data: {
          date: new Date(`${date}T00:00:00Z`),
          driverId: owner,
          status: "RELEASED",
          releaseRevision: 1,
          depotSnapshot: { name: "Depot", address: "x", lat: 48.2, lng: 16.3 },
          geometry: {
            type: "LineString",
            coordinates: [
              [16.3, 48.2],
              [16.3, 48.21],
            ],
          },
        },
      });
    const tour = await mkTour("2099-07-02", driverId);
    tourId = tour.id;
    // Inserted out of order on purpose: the read model sorts by sequence.
    const rows = [
      { c: customers[2], seq: 3, items: [{ productId: penne.id, quantity: 4 }] },
      {
        c: customers[0],
        seq: 1,
        items: [
          { productId: spaghetti.id, quantity: 13 },
          { productId: penne.id, quantity: 2 },
        ],
      },
      { c: customers[1], seq: 2, items: [{ productId: spaghetti.id, quantity: 5 }] },
    ];
    for (const r of rows) {
      await t.prisma.stop.create({
        data: {
          tourId: tour.id,
          customerId: r.c.id,
          sequence: r.seq,
          items: r.items,
          legDurationS: 600,
        },
      });
    }
    stopIds = (
      await t.prisma.stop.findMany({ where: { tourId }, orderBy: { sequence: "asc" } })
    ).map((s) => s.id);
    // Same day for another driver, and a tour of this driver on the previous day.
    const other = await mkTour("2099-07-02", otherDriverId);
    await t.prisma.stop.create({
      data: { tourId: other.id, customerId: customers[0].id, sequence: 1, items: [] },
    });
    await mkTour("2099-07-01", driverId);
  });

  afterAll(async () => {
    await t?.teardown();
  });

  const actor = (id: string, role: "DRIVER" | "ADMIN" = "DRIVER", locale = "zh-Hans") => ({
    id,
    role,
    locale,
  });

  it("computes today in the factory time zone", () => {
    expect(todayInTimezone(NOW, "Europe/Vienna")).toBe("2099-07-02");
    expect(todayInTimezone(NOW, "UTC")).toBe("2099-07-01");
  });

  it("returns the driver's stops in sequence with released quantities and localized product names", async () => {
    const today = await getDriverToday(t.prisma, actor(driverId), OPTIONS);
    expect(today?.tourId).toBe(tourId);
    expect(today?.date).toBe("2099-07-02");
    expect(today?.stops.map((s) => s.id)).toEqual(stopIds);
    expect(today?.stops.map((s) => s.customerName)).toEqual([
      "Trattoria 1",
      "Trattoria 2",
      "Trattoria 3",
    ]);
    expect(today?.stops[0]).toMatchObject({
      street: "Hauptstraße 1",
      postalCode: "1010",
      city: "Wien",
      lat: 48.21,
      lng: 16.3,
      items: [
        { name: "意大利面", unit: "KG", quantity: 13 },
        { name: "笔管面", unit: "PACK", quantity: 2 },
      ],
    });
    expect(today?.depot).toEqual({ name: "Depot", lat: 48.2, lng: 16.3 });
    expect(today?.geometry).toHaveLength(2);
    expect(today?.serviceSecondsPerStop).toBe(600);
  });

  it("picks the product name in the requested locale", async () => {
    const today = await getDriverToday(t.prisma, actor(driverId, "DRIVER", "de"), {
      ...OPTIONS,
      locale: "de",
    });
    expect(today?.stops[0].items.map((i) => i.name)).toEqual(["Spaghetti", "Penne"]);
  });

  it("never shows another driver's tour, another day's tour or any tour to an admin", async () => {
    const other = await getDriverToday(t.prisma, actor(otherDriverId), OPTIONS);
    expect(other?.tourId).not.toBe(tourId);
    expect(other?.stops).toHaveLength(1);
    expect(await getDriverToday(t.prisma, actor(adminId, "ADMIN"), OPTIONS)).toBeNull();
    expect(await getDriverToday(t.prisma, actor("nobody"), OPTIONS)).toBeNull();
    // On 1 July (UTC clock) the driver only has the day-before tour, which has no stops.
    const earlier = await getDriverToday(t.prisma, actor(driverId), {
      ...OPTIONS,
      timezone: "UTC",
    });
    expect(earlier?.tourId).not.toBe(tourId);
    expect(earlier?.stops).toEqual([]);
  });

  it("does not show a tour that is not released yet", async () => {
    await t.prisma.tour.update({ where: { id: tourId }, data: { status: "OPTIMIZED" } });
    expect(await getDriverToday(t.prisma, actor(driverId), OPTIONS)).toBeNull();
    await t.prisma.tour.update({ where: { id: tourId }, data: { status: "RELEASED" } });
  });

  describe("page query authorization", () => {
    it("rejects anonymous users and deactivated drivers", async () => {
      state.session = null;
      await expect(driverTodayQuery("de")).rejects.toBeInstanceOf(AuthorizationError);
      state.session = { user: { id: inactiveId } };
      await expect(driverTodayQuery("de")).rejects.toBeInstanceOf(AuthorizationError);
    });

    it("takes the driver from the session only", async () => {
      vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
      try {
        state.session = { user: { id: otherDriverId } };
        const mine = await driverTodayQuery("de");
        expect(mine?.stops).toHaveLength(1);
        expect(mine?.tourId).not.toBe(tourId);
        state.session = { user: { id: driverId } };
        expect((await driverTodayQuery("de"))?.tourId).toBe(tourId);
        state.session = { user: { id: adminId } };
        expect(await driverTodayQuery("de")).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
