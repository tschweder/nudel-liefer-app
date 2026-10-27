// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { requireDepot } from "@/domain/settings";

import { AuthorizationError } from "./auth/actor";
import { hashSecret } from "./auth/password";
import { LocalHeuristicProvider } from "./routing";
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

const { generateTourWith } = await import("./tour-builder");
const { releaseTourWith } = await import("./tour-planning");
const { driverStopQuery, getDriverStopDetail } = await import("./driver-stop");
const { setStorageForTests } = await import("./storage");

const DAY = new Date("2099-07-01T00:00:00Z");
const NOW = new Date("2099-07-01T08:00:00Z");
const SETTINGS = {
  depotName: "Nudelfabrik",
  depotAddress: "Graben 1, 1010 Wien",
  depotLat: 48.2,
  depotLng: 16.3,
  timezone: "Europe/Vienna",
  departureTime: "07:00",
  serviceMinutesPerStop: 10,
  deliveryWeekdays: [1, 2, 3, 4, 5],
};
const OPTIONS = { now: NOW, timezone: "Europe/Vienna", serviceMinutesPerStop: 10 };
const text = (de: string, hans?: string) => ({
  de,
  ...(hans ? { "zh-Hans": hans } : {}),
  meta: { source: "de", machine: {}, updatedAt: "2099-01-01T00:00:00Z" },
});

describe.skipIf(!process.env.DATABASE_URL)("driver stop detail", { timeout: 60_000 }, () => {
  let t: TestDb;
  let storage: FakeStorage;
  let adminId: string;
  let driverId: string;
  let vehicleId: string;
  let otherDriverId: string;
  let tourId: string;
  let stopIds: string[];
  let customerIds: string[];

  const actor = (id: string, role: "DRIVER" | "ADMIN" = "DRIVER", locale = "zh-Hans") => ({
    id,
    role,
    locale,
  });

  beforeAll(async () => {
    t = await createTestDb();
    state.db = t.prisma;
    storage = new FakeStorage();
    setStorageForTests(storage);
    const hash = await hashSecret("123456");
    const user = (data: Record<string, unknown>) =>
      t.prisma.user.create({ data: { passwordHash: hash, ...data } as never }).then((u) => u.id);
    adminId = await user({ role: "ADMIN", email: "a@example.com", displayName: "A" });
    driverId = await user({ role: "DRIVER", username: "drv", displayName: "D" });
    otherDriverId = await user({ role: "DRIVER", username: "drv2", displayName: "O" });
    vehicleId = (await t.prisma.vehicle.create({ data: { name: "Van", capacityKg: 1000 } })).id;

    const spaghetti = await t.prisma.product.create({
      data: {
        sku: "SPAG",
        unit: "KG",
        weightKgPerUnit: 1,
        name: text("Spaghetti lose", "意大利面"),
      },
    });
    const penne = await t.prisma.product.create({
      data: { sku: "PENN", unit: "PACK", weightKgPerUnit: 1, name: text("Penne", "笔管面") },
    });
    const mkCustomer = (n: string, lng: number, extra: Record<string, unknown> = {}) =>
      t.prisma.customer
        .create({
          data: {
            customerNumber: n,
            name: `Trattoria ${n}`,
            street: "Hauptstraße 1",
            postalCode: "1010",
            city: "Wien",
            lat: 48.2,
            lng,
            pinConfirmed: true,
            ...extra,
          },
        })
        .then((c) => c.id);
    customerIds = [
      await mkCustomer("K1", 16.4, {
        notes: text("Hintereingang benutzen"),
        deliveryHoursInfo: "Mo-Fr 8-11 Uhr",
      }),
      await mkCustomer("K2", 16.5, { notes: text("Klingeln", "按门铃") }),
      await mkCustomer("K3", 16.6),
    ];
    const order = (
      customerId: string,
      status: "CONFIRMED" | "DRAFT" | "CANCELLED",
      lines: Array<[string, number]>,
    ) =>
      t.prisma.order.create({
        data: {
          customerId,
          deliveryDate: DAY,
          windowFrom: DAY,
          windowTo: DAY,
          status,
          createdById: adminId,
          items: { create: lines.map(([productId, quantity]) => ({ productId, quantity })) },
        },
      });
    // Customer 1: two confirmed orders for the same day are merged into one stop; a draft and a
    // cancelled order never count.
    await order(customerIds[0], "CONFIRMED", [
      [spaghetti.id, 13],
      [penne.id, 2],
    ]);
    await order(customerIds[0], "CONFIRMED", [
      [spaghetti.id, 3],
      [penne.id, 1],
    ]);
    await order(customerIds[0], "DRAFT", [[spaghetti.id, 99]]);
    await order(customerIds[0], "CANCELLED", [[penne.id, 77]]);
    await order(customerIds[1], "CONFIRMED", [[spaghetti.id, 5]]);
    await order(customerIds[2], "CONFIRMED", [[penne.id, 4]]);

    const built = await generateTourWith(
      {
        db: t.prisma,
        actorId: adminId,
        provider: new LocalHeuristicProvider(),
        requireDepot: async () => requireDepot({ ...SETTINGS, depotPinConfirmed: true }),
        loadSettings: async () => SETTINGS,
        now: () => NOW,
      },
      DAY,
    );
    if (!built.ok) throw new Error(`generate failed: ${built.error}`);
    tourId = built.tourId;
    await t.prisma.tour.update({ where: { id: tourId }, data: { driverId, vehicleId } });
    const version = (await t.prisma.tour.findUniqueOrThrow({ where: { id: tourId } })).updatedAt;
    const released = await releaseTourWith(t.prisma, adminId, {
      tourId,
      version: version.toISOString(),
    });
    if (!released.ok) throw new Error(`release failed: ${released.error}`);
    stopIds = (
      await t.prisma.stop.findMany({ where: { tourId }, orderBy: { sequence: "asc" } })
    ).map((s) => s.id);

    // Customer 1 has a current shop photo and an old, replaced one; no parking photo.
    const put = async (key: string, isCurrent: boolean, kind: "STORE" | "PARKING") => {
      storage.put(key, new Uint8Array([1, 2, 3]), "image/jpeg");
      await t.prisma.photo.create({
        data: {
          customerId: customerIds[0],
          kind,
          storageKey: key,
          width: 800,
          height: 600,
          bytes: 3,
          uploadedById: adminId,
          isCurrent,
        },
      });
    };
    await put("customers/11111111-1111-4111-8111-111111111111.jpg", false, "STORE");
    await put("customers/22222222-2222-4222-8222-222222222222.jpg", true, "STORE");
  });

  afterAll(async () => {
    setStorageForTests(undefined);
    await t?.teardown();
  });

  const detail = (id: string, stopId: string, locale?: "de" | "zh-Hans") =>
    getDriverStopDetail(t.prisma, storage, actor(id), { ...OPTIONS, stopId, locale });

  it("shows the merged quantities of the stop's confirmed orders (drafts and cancelled excluded)", async () => {
    const first = stopIds[0];
    const stop = await t.prisma.stop.findUniqueOrThrow({
      where: { id: first },
      include: { customer: true },
    });
    expect(stop.customer.customerNumber).toBe("K1");
    const d = await detail(driverId, first, "de");
    expect(d?.stop.items).toMatchObject([
      { name: "Spaghetti lose", germanName: "Spaghetti lose", unit: "KG", quantity: 16 },
      { name: "Penne", germanName: "Penne", unit: "PACK", quantity: 3 },
    ]);
  });

  it("picks the product name in the driver's locale and keeps the German name", async () => {
    const d = await detail(driverId, stopIds[0], "zh-Hans");
    expect(d?.stop.items.map((i) => [i.name, i.germanName])).toEqual([
      ["意大利面", "Spaghetti lose"],
      ["笔管面", "Penne"],
    ]);
  });

  it("returns position, neighbours, address, pin, notes and delivery hours", async () => {
    const d = await detail(driverId, stopIds[1], "de");
    expect([d?.position, d?.total, d?.prevStopId, d?.nextStopId]).toEqual([
      2,
      3,
      stopIds[0],
      stopIds[2],
    ]);
    const first = await detail(driverId, stopIds[0], "de");
    expect(first?.prevStopId).toBeNull();
    expect(first?.stop).toMatchObject({ street: "Hauptstraße 1", lat: 48.2, lng: 16.4 });
    expect(first?.deliveryHoursInfo).toBe("Mo-Fr 8-11 Uhr");
    expect(first?.notes).toEqual({ text: "Hintereingang benutzen", lang: "de" });
  });

  it("falls back to the German note while the driver's language has none", async () => {
    const d = await detail(driverId, stopIds[0], "zh-Hans");
    expect(d?.notes).toEqual({ text: "Hintereingang benutzen", lang: "de" });
    const translated = await detail(driverId, stopIds[1], "zh-Hans");
    expect(translated?.notes).toEqual({ text: "按门铃", lang: "zh-Hans" });
    expect((await detail(driverId, stopIds[2], "de"))?.notes).toBeNull();
  });

  it("returns signed URLs of the current photos only; missing photos are null", async () => {
    const d = await detail(driverId, stopIds[0]);
    expect(d?.photos.STORE?.url).toContain("22222222-2222-4222-8222-222222222222");
    expect(d?.photos.STORE?.url).not.toContain("11111111");
    expect(d?.photos.STORE).toMatchObject({ width: 800, height: 600 });
    expect(d?.photos.PARKING).toBeNull();
    const none = await detail(driverId, stopIds[1]);
    expect(none?.photos).toEqual({ STORE: null, PARKING: null });
  });

  it("never shows a stop of another driver, an admin's view, unknown ids or unreleased tours", async () => {
    expect(await detail(otherDriverId, stopIds[0])).toBeNull();
    expect(
      await getDriverStopDetail(t.prisma, storage, actor(adminId, "ADMIN"), {
        ...OPTIONS,
        stopId: stopIds[0],
      }),
    ).toBeNull();
    expect(await detail(driverId, "nope")).toBeNull();
    // Another day (UTC clock is still 1 July but the tour of 2 July is not today).
    expect(
      await getDriverStopDetail(t.prisma, storage, actor(driverId), {
        ...OPTIONS,
        now: new Date("2099-07-05T08:00:00Z"),
        stopId: stopIds[0],
      }),
    ).toBeNull();
    await t.prisma.tour.update({ where: { id: tourId }, data: { status: "OPTIMIZED" } });
    expect(await detail(driverId, stopIds[0])).toBeNull();
    await t.prisma.tour.update({ where: { id: tourId }, data: { status: "RELEASED" } });
  });

  it("page query rejects anonymous users and only serves the session driver's stops", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    try {
      state.session = null;
      await expect(driverStopQuery("de", stopIds[0])).rejects.toBeInstanceOf(AuthorizationError);
      state.session = { user: { id: otherDriverId } };
      expect(await driverStopQuery("de", stopIds[0])).toBeNull();
      state.session = { user: { id: driverId } };
      expect((await driverStopQuery("de", stopIds[0]))?.stop.id).toBe(stopIds[0]);
    } finally {
      vi.useRealTimers();
    }
  });
});
