// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { driverTourResponseSchema, tourPhotos } from "@/lib/driver-tour-model";

import { hashSecret } from "./auth/password";
import { FakeStorage } from "./storage/fake";
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

const { driverTourTodayResponse } = await import("./driver-tour-api");
const { getDriverTourResponse, DRIVER_PHOTO_URL_TTL_SECONDS } =
  await import("./driver-tour-payload");
const { setStorageForTests } = await import("./storage");

// 22:30 UTC on 1 July is already 2 July in Vienna: "today" is the factory's calendar day.
const NOW = new Date("2099-07-01T22:30:00Z");
const text = (de: string, hans: string) => ({
  de,
  "zh-Hans": hans,
  "zh-Hant-HK": `${hans}HK`,
  "zh-Hant-TW": `${hans}TW`,
  meta: { source: "de", machine: {}, updatedAt: "2099-01-01T00:00:00Z" },
});

class RecordingStorage extends FakeStorage {
  ttls: Array<number | undefined> = [];
  async getReadUrl(key: string, options?: { expiresInSeconds?: number }) {
    this.ttls.push(options?.expiresInSeconds);
    return super.getReadUrl(key, options);
  }
}

describe.skipIf(!process.env.DATABASE_URL)("driver tour API (NUD-081)", { timeout: 60_000 }, () => {
  let t: TestDb;
  let storage: RecordingStorage;
  let driverId: string;
  let otherDriverId: string;
  let adminId: string;
  let inactiveId: string;
  let stopIds: string[];
  let photoIds: Record<string, string>;

  beforeAll(async () => {
    t = await createTestDb();
    state.db = t.prisma;
    storage = new RecordingStorage();
    setStorageForTests(storage);
    const hash = await hashSecret("123456");
    const user = (data: Record<string, unknown>) =>
      t.prisma.user.create({ data: { passwordHash: hash, ...data } as never }).then((u) => u.id);
    adminId = await user({ role: "ADMIN", email: "a@example.com", displayName: "A" });
    driverId = await user({ role: "DRIVER", username: "drv", displayName: "Driver" });
    otherDriverId = await user({ role: "DRIVER", username: "drv2", displayName: "Other" });
    inactiveId = await user({ role: "DRIVER", username: "drv3", displayName: "G", active: false });

    const spaghetti = await t.prisma.product.create({
      data: { sku: "SPAG", unit: "KG", weightKgPerUnit: 1, name: text("Spaghetti", "意大利面") },
    });
    const penne = await t.prisma.product.create({
      data: { sku: "PENN", unit: "PACK", weightKgPerUnit: 1, name: text("Penne", "笔管面") },
    });
    const customers = [];
    for (const n of [1, 2]) {
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
            notes: n === 1 ? text("Hintereingang", "后门") : undefined,
            deliveryHoursInfo: n === 1 ? "Mo-Fr 8-11" : null,
          },
        }),
      );
    }
    photoIds = {};
    const photo = async (
      customerId: string,
      kind: "STORE" | "PARKING",
      key: string,
      current: boolean,
    ) => {
      const p = await t.prisma.photo.create({
        data: {
          customerId,
          kind,
          storageKey: key,
          width: 800,
          height: 600,
          bytes: 1000,
          uploadedById: adminId,
          isCurrent: current,
        },
      });
      return p.id;
    };
    await photo(customers[0].id, "STORE", "customers/old.jpg", false); // replaced photo: history
    photoIds.store1 = await photo(customers[0].id, "STORE", "customers/s1.jpg", true);
    photoIds.park1 = await photo(customers[0].id, "PARKING", "customers/p1.jpg", true);

    const mkTour = (date: string, owner: string, extra: Record<string, unknown> = {}) =>
      t.prisma.tour.create({
        data: {
          date: new Date(`${date}T00:00:00Z`),
          driverId: owner,
          status: "RELEASED",
          releaseRevision: 1,
          depotSnapshot: { name: "Depot", address: "x", lat: 48.2, lng: 16.3 },
          ...extra,
        } as never,
      });
    const tour = await mkTour("2099-07-02", driverId, {
      releaseRevision: 2,
      reReleasedAt: new Date("2099-07-02T05:00:00Z"),
      lastChange: {
        revision: 2,
        removed: [{ customerId: "gone", customerNumber: "K9", name: "Gone GmbH" }],
      },
    });
    await t.prisma.stop.create({
      data: {
        tourId: tour.id,
        customerId: customers[1].id,
        sequence: 2,
        items: [{ productId: spaghetti.id, quantity: 5 }],
        previousItems: [{ productId: spaghetti.id, quantity: 3 }],
        changeKind: "CHANGED",
        changedInRevision: 2,
      },
    });
    await t.prisma.stop.create({
      data: {
        tourId: tour.id,
        customerId: customers[0].id,
        sequence: 1,
        items: [
          { productId: spaghetti.id, quantity: 13 },
          { productId: penne.id, quantity: 2 },
        ],
        legDurationS: 600,
      },
    });
    stopIds = (
      await t.prisma.stop.findMany({ where: { tourId: tour.id }, orderBy: { sequence: "asc" } })
    ).map((s) => s.id);
    const other = await mkTour("2099-07-02", otherDriverId);
    await t.prisma.stop.create({
      data: { tourId: other.id, customerId: customers[0].id, sequence: 1, items: [] },
    });
    await mkTour("2099-07-01", driverId); // yesterday's tour of the same driver
  });

  afterAll(async () => {
    setStorageForTests(undefined);
    await t?.teardown();
  });

  const asUser = (id: string | null) => void (state.session = id ? { user: { id } } : null);
  const body = async (res: Response) => (await res.json()) as unknown;

  it("answers anonymous requests with 401 and no data", async () => {
    asUser(null);
    const res = await driverTourTodayResponse(NOW);
    expect(res.status).toBe(401);
    expect(await body(res)).toEqual({ error: "unauthenticated" });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("answers an admin (support view) and a deactivated driver without a tour", async () => {
    asUser(adminId);
    const admin = await driverTourTodayResponse(NOW);
    expect(admin.status).toBe(403);
    expect(await body(admin)).toEqual({ error: "forbidden" });
    asUser(inactiveId);
    expect((await driverTourTodayResponse(NOW)).status).toBe(401);
  });

  it("returns the driver's own tour of today, valid against the shared schema", async () => {
    asUser(driverId);
    const res = await driverTourTodayResponse(NOW);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("content-type")).toContain("application/json");
    const data = driverTourResponseSchema.parse(await res.json());
    expect(data.date).toBe("2099-07-02");
    expect(data.timezone).toBe("Europe/Vienna");
    expect(data.tour?.stops.map((s) => s.id)).toEqual(stopIds);
    expect(data.tour?.stops.map((s) => s.customerName)).toEqual(["Trattoria 1", "Trattoria 2"]);
  });

  it("carries product names and notes in all locales, not only one", async () => {
    asUser(driverId);
    const data = driverTourResponseSchema.parse(await (await driverTourTodayResponse(NOW)).json());
    const first = data.tour!.stops[0]!;
    expect(first.items[0]!.name).toMatchObject({
      de: "Spaghetti",
      "zh-Hans": "意大利面",
      "zh-Hant-HK": "意大利面HK",
      "zh-Hant-TW": "意大利面TW",
    });
    expect(first.notes).toMatchObject({ de: "Hintereingang", "zh-Hans": "后门" });
    expect(first.deliveryHoursInfo).toBe("Mo-Fr 8-11");
    expect(first.items.map((i) => i.quantity)).toEqual([13, 2]);
  });

  it("keeps the updated-tour data of NUD-043 in the payload", async () => {
    asUser(driverId);
    const data = driverTourResponseSchema.parse(await (await driverTourTodayResponse(NOW)).json());
    expect(data.tour).toMatchObject({
      revision: 2,
      updated: true,
      removedCustomers: [{ name: "Gone GmbH" }],
    });
    expect(data.tour!.stops[1]).toMatchObject({ change: "CHANGED", changedInRevision: 2 });
    expect(data.tour!.stops[1]!.items[0]).toMatchObject({
      quantity: 5,
      previousQuantity: 3,
    });
    expect(data.tour!.stops[0]).toMatchObject({ change: null, changedInRevision: null });
  });

  it("signs the current photos only, valid for at least 12 hours", async () => {
    asUser(driverId);
    storage.ttls = [];
    const data = driverTourResponseSchema.parse(await (await driverTourTodayResponse(NOW)).json());
    const first = data.tour!.stops[0]!;
    expect(first.photos.STORE).toMatchObject({ id: photoIds.store1, width: 800, height: 600 });
    expect(first.photos.STORE!.url).toContain("customers/s1.jpg");
    expect(first.photos.PARKING?.id).toBe(photoIds.park1);
    expect(data.tour!.stops[1]!.photos).toEqual({ STORE: null, PARKING: null });
    expect(
      tourPhotos(data)
        .map((p) => p.id)
        .sort(),
    ).toEqual([photoIds.park1, photoIds.store1].sort());
    expect(DRIVER_PHOTO_URL_TTL_SECONDS).toBeGreaterThanOrEqual(12 * 3600);
    expect(storage.ttls.length).toBe(2);
    for (const ttl of storage.ttls) expect(ttl).toBeGreaterThanOrEqual(12 * 3600);
  });

  it("gives every driver only his own tour and nothing for other days", async () => {
    asUser(otherDriverId);
    const other = driverTourResponseSchema.parse(await (await driverTourTodayResponse(NOW)).json());
    expect(other.tour?.stops).toHaveLength(1);
    expect(other.tour?.stops.some((s) => stopIds.includes(s.id))).toBe(false);

    asUser(driverId);
    // On 1 July (UTC clock) only the stop-less tour of the day before exists.
    const early = await getDriverTourResponse(
      state.db!,
      { id: driverId, role: "DRIVER" },
      { now: NOW, timezone: "UTC", serviceMinutesPerStop: 10 },
    );
    expect(early.date).toBe("2099-07-01");
    expect(early.tour?.stops).toEqual([]);
  });

  it("has no tour for non-drivers, unknown users and unreleased tours", async () => {
    const options = { now: NOW, timezone: "Europe/Vienna", serviceMinutesPerStop: 10 };
    expect(
      (await getDriverTourResponse(t.prisma, { id: adminId, role: "ADMIN" }, options)).tour,
    ).toBeNull();
    expect(
      (await getDriverTourResponse(t.prisma, { id: "nobody", role: "DRIVER" }, options)).tour,
    ).toBeNull();
    const tour = await t.prisma.tour.findFirstOrThrow({
      where: { driverId, date: new Date("2099-07-02T00:00:00Z") },
    });
    await t.prisma.tour.update({ where: { id: tour.id }, data: { status: "OPTIMIZED" } });
    asUser(driverId);
    const res = driverTourResponseSchema.parse(await (await driverTourTodayResponse(NOW)).json());
    expect(res.tour).toBeNull();
    await t.prisma.tour.update({ where: { id: tour.id }, data: { status: "RELEASED" } });
  });

  it("ignores request parameters: there is no way to ask for another driver", async () => {
    // The handler takes no input at all; the driver id is the session user.
    expect(driverTourTodayResponse.length).toBeLessThanOrEqual(1);
  });
});
