// @vitest-environment node
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hashSecret } from "./auth/password";
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

const { driverPhotoResponse, registerDriverPhoto } = await import("./driver-photos");
const { getCustomerPhotos } = await import("./customer-photos");
const { addCustomerPhotoAction } = await import("./customer-actions");
const { setStorageForTests } = await import("./storage");

const NOW = new Date("2099-07-02T10:00:00.000Z"); // 2099-07-02 in Europe/Vienna
const TZ = "Europe/Vienna";

describe.skipIf(!process.env.DATABASE_URL)("driver photo capture", { timeout: 60_000 }, () => {
  let t: TestDb;
  let storage: FakeStorage;
  let driverId: string;
  let otherDriverId: string;
  let adminId: string;
  let customerIds: string[];
  let stopIds: string[]; // driver's stops of today's RELEASED tour
  let tourId: string;
  let foreignStopId: string;
  let seq = 0;

  const key = (ext = "jpg") =>
    `customers/${(++seq).toString(16).padStart(8, "0")}-0000-4000-8000-000000000000.${ext}`;
  const uploaded = (k = key(), bytes = 4321) => {
    storage.put(k, new Uint8Array(bytes), "image/jpeg");
    return k;
  };
  const body = (stop: number, kind: "STORE" | "PARKING", extra: Record<string, unknown> = {}) => ({
    clientMutationId: randomUUID(),
    stopId: stopIds[stop]!,
    kind,
    storageKey: uploaded(),
    width: 1600,
    height: 1200,
    ...extra,
  });
  const actor = (id = driverId) => ({ id, role: "DRIVER" as const });
  const register = (raw: unknown, who = actor(), now = NOW) =>
    registerDriverPhoto(t.prisma, who, raw, { storage, timezone: TZ }, now);
  const photosOf = (customerId: string) =>
    t.prisma.photo.findMany({ where: { customerId }, orderBy: { createdAt: "asc" } });
  const depot = { name: "Depot", address: "x", lat: 48.2, lng: 16.3 };

  async function makeTour(
    driver: string | null,
    date: string,
    status: "DRAFT" | "OPTIMIZED" | "RELEASED" | "IN_PROGRESS" | "COMPLETED",
    customerId: string,
  ) {
    const tour = await t.prisma.tour.create({
      data: {
        date: new Date(`${date}T00:00:00Z`),
        driverId: driver,
        status,
        releaseRevision: 1,
        depotSnapshot: depot,
      },
    });
    const stop = await t.prisma.stop.create({
      data: { tourId: tour.id, customerId, sequence: 1, items: [] },
    });
    return { tourId: tour.id, stopId: stop.id };
  }

  beforeAll(async () => {
    t = await createTestDb();
    state.db = t.prisma;
    storage = new FakeStorage();
    setStorageForTests(storage);
    const hash = await hashSecret("123456");
    const user = (data: Record<string, unknown>) =>
      t.prisma.user.create({ data: { passwordHash: hash, ...data } as never }).then((u) => u.id);
    adminId = await user({ role: "ADMIN", email: "a@example.com", displayName: "Büro" });
    driverId = await user({
      role: "DRIVER",
      username: "drv",
      displayName: "Fahrer Ali",
      localeChosen: true,
    });
    otherDriverId = await user({ role: "DRIVER", username: "drv2", displayName: "Other" });
    customerIds = [];
    for (const n of [1, 2, 3, 4, 5, 6]) {
      const c = await t.prisma.customer.create({
        data: {
          customerNumber: `K${n}`,
          name: `Trattoria ${n}`,
          street: "Hauptstraße 1",
          postalCode: "1010",
          city: "Wien",
        },
      });
      customerIds.push(c.id);
    }
    const tour = await t.prisma.tour.create({
      data: {
        date: new Date("2099-07-02T00:00:00Z"),
        driverId,
        status: "RELEASED",
        releaseRevision: 1,
        depotSnapshot: depot,
      },
    });
    tourId = tour.id;
    stopIds = [];
    for (const [i, customerId] of customerIds.slice(0, 2).entries()) {
      stopIds.push(
        (await t.prisma.stop.create({ data: { tourId, customerId, sequence: i + 1, items: [] } }))
          .id,
      );
    }
    foreignStopId = (await makeTour(otherDriverId, "2099-07-02", "RELEASED", customerIds[2]!))
      .stopId;
  });

  beforeEach(async () => {
    state.session = null;
    await t.prisma.photo.deleteMany();
    await t.prisma.tour.update({ where: { id: tourId }, data: { status: "RELEASED" } });
  });

  afterAll(async () => {
    setStorageForTests(undefined);
    await t?.teardown();
  });

  it("stores the photo as the customer's current one, attributed to the driver, with the stop's customer", async () => {
    const input = body(0, "STORE");
    const res = await register(input);
    expect(res).toMatchObject({ outcome: "applied", kind: "STORE", customerId: customerIds[0] });
    const rows = await photosOf(customerIds[0]!);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "STORE",
      isCurrent: true,
      uploadedById: driverId,
      clientMutationId: input.clientMutationId,
      storageKey: input.storageKey,
      bytes: 4321,
      width: 1600,
    });
    expect(await photosOf(customerIds[1]!)).toHaveLength(0);
    if (res.outcome === "rejected") throw new Error("unreachable");
    expect(res.photo.id).toBe(rows[0]!.id);
    expect(res.photo.url).toContain(input.storageKey);
    expect(res.photo.url).toContain(`expires=${12 * 3600}`);
  });

  it("the office sees who took the photo (uploadedBy), a replacement keeps the old one as history", async () => {
    const first = await register(body(0, "STORE"));
    const second = await register(body(0, "STORE"));
    expect(first.outcome).toBe("applied");
    expect(second.outcome).toBe("applied");
    const rows = await photosOf(customerIds[0]!);
    expect(rows.map((r) => r.isCurrent)).toEqual([false, true]);
    const shown = await getCustomerPhotos(t.prisma, storage, customerIds[0]);
    expect(shown.STORE?.uploadedBy).toEqual({ name: "Fahrer Ali", role: "DRIVER" });
    expect(shown.STORE?.createdAt).toBeInstanceOf(Date);
    expect(shown.PARKING).toBeNull();
    // an office upload is attributed to the office user
    state.session = { user: { id: adminId } };
    await addCustomerPhotoAction({
      customerId: customerIds[0],
      kind: "PARKING",
      storageKey: uploaded(),
      width: 10,
      height: 10,
    });
    const both = await getCustomerPhotos(t.prisma, storage, customerIds[0]);
    expect(both.PARKING?.uploadedBy).toEqual({ name: "Büro", role: "ADMIN" });
    expect(both.STORE?.uploadedBy.role).toBe("DRIVER");
  });

  describe("authorization", () => {
    it("other drivers' and unknown stops are not found, the same answer for both", async () => {
      const foreign = await register({ ...body(0, "STORE"), stopId: foreignStopId });
      const unknown = await register({ ...body(0, "STORE"), stopId: "nope" });
      expect(foreign).toEqual({ outcome: "rejected", error: "not_found" });
      expect(unknown).toEqual(foreign);
      expect(await t.prisma.photo.count()).toBe(0);
      // and the other way round
      expect(await register({ ...body(0, "STORE") }, actor(otherDriverId))).toEqual(foreign);
    });

    it("a non-driver actor is refused at the function level too", async () => {
      expect(await register(body(0, "STORE"), { id: adminId, role: "ADMIN" as never })).toEqual({
        outcome: "rejected",
        error: "not_found",
      });
      expect(await t.prisma.photo.count()).toBe(0);
    });

    it("the customer cannot be chosen by the client (strict input)", async () => {
      expect(await register({ ...body(0, "STORE"), customerId: customerIds[3] })).toEqual({
        outcome: "rejected",
        error: "invalid",
      });
      expect(await t.prisma.photo.count()).toBe(0);
    });

    it.each([
      ["a tour that is not released", "DRAFT"],
      ["an optimized tour", "OPTIMIZED"],
    ] as const)("%s is closed for photos", async (_name, status) => {
      const own = await makeTour(driverId, "2099-07-02", status, customerIds[3]!);
      const res = await register({ ...body(0, "STORE"), stopId: own.stopId });
      expect(res).toEqual({ outcome: "rejected", error: "tour_not_active" });
    });

    it.each([
      ["today, released", "2099-07-02", "RELEASED", true],
      ["today, in progress", "2099-07-02", "IN_PROGRESS", true],
      ["today, completed", "2099-07-02", "COMPLETED", true],
      ["yesterday (queued offline)", "2099-07-01", "IN_PROGRESS", true],
      ["two days ago", "2099-06-30", "COMPLETED", false],
      ["tomorrow", "2099-07-03", "RELEASED", false],
    ] as const)("tour of %s", async (_name, date, status, allowed) => {
      const own = await makeTour(driverId, date, status, customerIds[4]!);
      const res = await register({ ...body(0, "PARKING"), stopId: own.stopId });
      if (allowed) expect(res.outcome).toBe("applied");
      else expect(res).toEqual({ outcome: "rejected", error: "tour_not_active" });
      await t.prisma.stop.deleteMany({ where: { id: own.stopId } });
      await t.prisma.photo.deleteMany();
      await t.prisma.tour.delete({ where: { id: own.tourId } });
    });

    it("'today' follows the factory time zone, not UTC", async () => {
      // 23:30 UTC on the 2nd is already the 3rd in Vienna: the tour of the 2nd is 'yesterday' (ok);
      // one more day later it is closed.
      const lateEvening = new Date("2099-07-02T23:30:00Z");
      expect((await register(body(0, "STORE"), actor(), lateEvening)).outcome).toBe("applied");
      const nextDay = new Date("2099-07-03T23:30:00Z");
      expect(await register(body(0, "PARKING"), actor(), nextDay)).toEqual({
        outcome: "rejected",
        error: "tour_not_active",
      });
    });
  });

  describe("input validation", () => {
    it.each([
      ["another prefix", "screenshots/00000001-0000-4000-8000-000000000000.jpg"],
      ["path traversal", "customers/../secret.jpg"],
      ["not a uuid", "customers/abc.jpg"],
      ["wrong extension", "customers/00000001-0000-4000-8000-000000000000.gif"],
      ["external url", "https://evil.example/x.jpg"],
      ["empty", ""],
    ])("forged storage key (%s) is invalid", async (_name, storageKey) => {
      expect(await register({ ...body(0, "STORE"), storageKey })).toEqual({
        outcome: "rejected",
        error: "invalid",
      });
      expect(await t.prisma.photo.count()).toBe(0);
    });

    it.each([
      ["kind", { kind: "ROOF" }],
      ["id not a uuid", { clientMutationId: "1" }],
      ["zero width", { width: 0 }],
      ["huge height", { height: 99999 }],
      ["fractional width", { width: 10.5 }],
      ["unknown field", { extra: true }],
    ])("rejects invalid input: %s", async (_name, extra) => {
      expect(await register({ ...body(0, "STORE"), ...extra })).toEqual({
        outcome: "rejected",
        error: "invalid",
      });
    });

    it("an object that was never uploaded (or is empty) is refused; size comes from storage", async () => {
      expect(await register({ ...body(0, "STORE"), storageKey: key() })).toEqual({
        outcome: "rejected",
        error: "object_missing",
      });
      expect(await register({ ...body(0, "STORE"), storageKey: uploaded(key(), 0) })).toEqual({
        outcome: "rejected",
        error: "invalid",
      });
      expect(await t.prisma.photo.count()).toBe(0);
    });

    it("a storage key can be attached only once", async () => {
      const first = body(0, "STORE");
      expect((await register(first)).outcome).toBe("applied");
      const reuse = { ...body(1, "PARKING"), storageKey: first.storageKey };
      expect(await register(reuse)).toEqual({ outcome: "rejected", error: "key_in_use" });
    });
  });

  describe("idempotency (offline retries)", () => {
    it("a replay returns the photo of the first call and creates nothing", async () => {
      const input = body(0, "STORE");
      const first = await register(input);
      const second = await register(input);
      expect(first.outcome).toBe("applied");
      expect(second.outcome).toBe("replayed");
      if (first.outcome === "rejected" || second.outcome === "rejected") throw new Error("x");
      expect(second.photo.id).toBe(first.photo.id);
      expect(await t.prisma.photo.count()).toBe(1);
    });

    it("a replay is answered even after a newer photo replaced it and the tour was closed", async () => {
      const input = body(0, "STORE");
      await register(input);
      await register(body(0, "STORE")); // replaces it
      await t.prisma.tour.update({ where: { id: tourId }, data: { status: "COMPLETED" } });
      const later = new Date("2099-07-10T10:00:00Z"); // the tour is long closed for new photos
      expect((await register(input, actor(), later)).outcome).toBe("replayed");
      expect(await t.prisma.photo.count()).toBe(2);
      expect((await photosOf(customerIds[0]!)).filter((p) => p.isCurrent)).toHaveLength(1);
    });

    it("concurrent retries create exactly one photo", async () => {
      const input = body(1, "PARKING");
      const results = await Promise.all(Array.from({ length: 6 }, () => register(input)));
      expect(results.filter((r) => r.outcome === "applied")).toHaveLength(1);
      expect(results.filter((r) => r.outcome === "replayed")).toHaveLength(5);
      expect(await t.prisma.photo.count()).toBe(1);
    });

    it("the same id from another driver is a conflict and changes nothing", async () => {
      const mine = body(0, "STORE");
      await register(mine);
      const theirStop = await makeTour(otherDriverId, "2099-07-02", "RELEASED", customerIds[5]!);
      const res = await register(
        { ...mine, stopId: theirStop.stopId, storageKey: uploaded() },
        actor(otherDriverId),
      );
      expect(res).toEqual({ outcome: "rejected", error: "mutation_conflict" });
      expect(await t.prisma.photo.count()).toBe(1);
    });

    it("concurrent different photos of one slot leave exactly one current photo", async () => {
      await Promise.all([register(body(0, "STORE")), register(body(0, "STORE"))]);
      const rows = await photosOf(customerIds[0]!);
      expect(rows).toHaveLength(2);
      expect(rows.filter((r) => r.isCurrent)).toHaveLength(1);
    });
  });

  describe("route POST /api/driver/photos", () => {
    const post = (payload: unknown, headers: Record<string, string> = {}) =>
      driverPhotoResponse(
        new Request("http://localhost/api/driver/photos", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body: typeof payload === "string" ? payload : JSON.stringify(payload),
        }),
        NOW,
      );

    it("anonymous -> 401, admin -> 403, nothing written, never cached", async () => {
      const input = body(0, "STORE");
      const anon = await post(input);
      expect(anon.status).toBe(401);
      expect(anon.headers.get("cache-control")).toBe("private, no-store");
      state.session = { user: { id: adminId } };
      expect((await post(input)).status).toBe(403);
      expect(await t.prisma.photo.count()).toBe(0);
    });

    it("a deactivated driver is refused", async () => {
      await t.prisma.user.update({ where: { id: driverId }, data: { active: false } });
      try {
        state.session = { user: { id: driverId } };
        expect((await post(body(0, "STORE"))).status).toBe(401);
      } finally {
        await t.prisma.user.update({ where: { id: driverId }, data: { active: true } });
      }
    });

    it("driver: applied, then replayed with the same photo", async () => {
      state.session = { user: { id: driverId } };
      const input = body(0, "PARKING");
      const first = await post(input);
      expect(first.status).toBe(200);
      const a = await first.json();
      expect(a).toMatchObject({ outcome: "applied", kind: "PARKING", customerId: customerIds[0] });
      const b = await (await post(input)).json();
      expect(b).toMatchObject({ outcome: "replayed" });
      expect(b.photo.id).toBe(a.photo.id);
    });

    it("business rejection is HTTP 200 with the reason; malformed requests are 4xx", async () => {
      state.session = { user: { id: driverId } };
      const res = await post({ ...body(0, "STORE"), stopId: foreignStopId });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ outcome: "rejected", error: "not_found" });
      expect((await post("{not json")).status).toBe(400);
      expect((await post({ ...body(0, "STORE"), kind: "X" })).status).toBe(400);
      expect((await post({ ...body(0, "STORE"), customerId: "c" })).status).toBe(400);
      expect((await post(body(0, "STORE"), { "Content-Type": "text/plain" })).status).toBe(415);
      expect((await post("x".repeat(9000))).status).toBe(413);
      expect(await t.prisma.photo.count()).toBe(0);
    });
  });
});
