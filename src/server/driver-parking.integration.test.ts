// @vitest-environment node
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { SyncEntry } from "@/domain/driver-sync";

import { hashSecret } from "./auth/password";
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

const { applySyncBatch, driverSyncResponse } = await import("./driver-sync");
const { applyDriverParking } = await import("./parking-spots");
const { getDriverTourResponse } = await import("./driver-tour-payload");

const T0 = new Date("2099-07-02T08:00:00.000Z");
const SERVER_NOW = new Date("2099-07-02T10:00:00.000Z");

describe.skipIf(!process.env.DATABASE_URL)(
  "driver sets a Parkplatz (NUD-144)",
  { timeout: 60_000 },
  () => {
    let t: TestDb;
    let adminId: string;
    let driverId: string;
    let otherDriverId: string;
    let customerId: string;
    let stopId: string;
    let foreignStopId: string;

    const driver = (id = driverId) => ({ id, role: "DRIVER" as const, locale: "de" });
    const entry = (extra: Partial<SyncEntry> = {}): SyncEntry => ({
      clientMutationId: randomUUID(),
      type: "parking",
      stopId,
      lat: 48.2082,
      lng: 16.3738,
      createdAt: T0.toISOString(),
      ...extra,
    });
    const sync = (entries: SyncEntry[], who = driver()) =>
      applySyncBatch(t.prisma, who, entries, SERVER_NOW, { afterApply: () => undefined });
    const spots = () =>
      t.prisma.parkingSpot.findMany({
        where: { customerId },
        orderBy: { sortOrder: "asc" },
      });
    let since = new Date();
    const audits = () =>
      t.prisma.auditLog.findMany({
        where: {
          entity: "Customer",
          entityId: customerId,
          action: "parking.create",
          createdAt: { gte: since },
        },
      });

    beforeAll(async () => {
      t = await createTestDb();
      state.db = t.prisma;
      const hash = await hashSecret("123456");
      const user = (data: Record<string, unknown>) =>
        t.prisma.user.create({ data: { passwordHash: hash, ...data } as never }).then((u) => u.id);
      adminId = await user({ role: "ADMIN", email: "a@example.com", displayName: "Büro Anna" });
      driverId = await user({ role: "DRIVER", username: "drv", displayName: "Fahrer Marko" });
      otherDriverId = await user({ role: "DRIVER", username: "drv2", displayName: "Other" });
      const mkCustomer = (n: number) =>
        t.prisma.customer
          .create({
            data: {
              customerNumber: `P${n}`,
              name: `Trattoria ${n}`,
              street: "Hauptstraße 1",
              postalCode: "1010",
              city: "Wien",
              lat: 48.2,
              lng: 16.3,
            },
          })
          .then((c) => c.id);
      customerId = await mkCustomer(1);
      const foreignCustomerId = await mkCustomer(2);
      const depot = { name: "Depot", address: "x", lat: 48.2, lng: 16.3 };
      const mkTour = (day: number, who: string) =>
        t.prisma.tour.create({
          data: {
            date: new Date(`2099-07-0${day}T00:00:00Z`),
            driverId: who,
            status: "RELEASED",
            releaseRevision: 1,
            depotSnapshot: depot,
          },
        });
      const tour = await mkTour(2, driverId);
      stopId = (
        await t.prisma.stop.create({
          data: { tourId: tour.id, customerId, sequence: 1, items: [] },
        })
      ).id;
      const foreign = await mkTour(3, otherDriverId);
      foreignStopId = (
        await t.prisma.stop.create({
          data: { tourId: foreign.id, customerId: foreignCustomerId, sequence: 1, items: [] },
        })
      ).id;
    });

    beforeEach(async () => {
      since = new Date();
      state.session = null;
      await t.prisma.stopMutation.deleteMany();
      await t.prisma.parkingSpot.deleteMany();
    });

    afterAll(async () => {
      await t?.teardown();
    });

    it("saves the first Parkplatz as the default and returns it in the sync answer", async () => {
      const res = await sync([entry({ lat: 48.20821234567, lng: 16.37381234567 })]);
      expect(res.results[0]!.outcome).toBe("applied");
      const stored = await spots();
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({
        lat: 48.208212,
        lng: 16.373812,
        createdById: driverId,
        active: true,
      });
      expect(res.tours[0]!.stops[0]!.parkingSpots).toEqual([
        { label: null, note: null, lat: 48.208212, lng: 16.373812 },
      ]);
      const log = await audits();
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({ actorId: driverId });
      expect(log[0]!.diff).toMatchObject({ isDefault: true, via: "sync" });
    });

    it("the next driver payload navigates to the new Parkplatz", async () => {
      await sync([entry({ lat: 48.5, lng: 16.9 })]);
      const response = await getDriverTourResponse(
        t.prisma,
        { id: driverId, role: "DRIVER" },
        {
          now: new Date("2099-07-02T06:00:00.000Z"),
          timezone: "Europe/Vienna",
          serviceMinutesPerStop: 10,
        },
      );
      expect(response.tour?.stops[0]).toMatchObject({
        lat: 48.5,
        lng: 16.9,
        addressLat: 48.2,
        addressLng: 16.3,
        parkingSpots: [{ lat: 48.5, lng: 16.9 }],
      });
    });

    it("a further Parkplatz is appended; the existing default stays", async () => {
      await sync([entry({ lat: 48.5, lng: 16.9 })]);
      await sync([entry({ lat: 48.6, lng: 17 })]);
      expect((await spots()).map((s) => [s.lat, s.lng])).toEqual([
        [48.5, 16.9],
        [48.6, 17],
      ]);
    });

    it("is idempotent by clientMutationId", async () => {
      const first = entry();
      expect((await sync([first])).results[0]!.outcome).toBe("applied");
      expect((await sync([first])).results[0]!.outcome).toBe("replayed");
      expect(await spots()).toHaveLength(1);
      expect(await audits()).toHaveLength(1);
    });

    it("rejects a stop of another driver, an unknown stop and a full list", async () => {
      const res = await sync([entry({ stopId: foreignStopId }), entry({ stopId: "nope" })]);
      expect(res.results.map((r) => [r.outcome, r.error])).toEqual([
        ["rejected", "not_found"],
        ["rejected", "not_found"],
      ]);
      expect(await spots()).toHaveLength(0);
      for (let i = 0; i < 10; i += 1) await sync([entry({ lat: 48 + i / 100 })]);
      const full = await sync([entry({ lat: 49, lng: 17 })]);
      expect(full.results[0]).toMatchObject({ outcome: "rejected", error: "limit" });
      expect(await spots()).toHaveLength(10);
    });

    it("validates coordinates and the role", async () => {
      const raw = (extra: Record<string, unknown> = {}) => ({
        type: "parking",
        clientMutationId: randomUUID(),
        stopId,
        lat: 48.2,
        lng: 16.3,
        ...extra,
      });
      expect(await applyDriverParking(t.prisma, driver(), raw({ lat: 91 }))).toEqual({
        ok: false,
        error: "invalid",
      });
      expect(await applyDriverParking(t.prisma, driver(), raw({ lng: -181 }))).toEqual({
        ok: false,
        error: "invalid",
      });
      expect(await applyDriverParking(t.prisma, { id: adminId, role: "ADMIN" }, raw())).toEqual({
        ok: false,
        error: "forbidden",
      });
      const id = randomUUID();
      await sync([entry({ clientMutationId: id })]);
      expect(
        await applyDriverParking(
          t.prisma,
          driver(otherDriverId),
          raw({ clientMutationId: id, stopId: foreignStopId }),
        ),
      ).toEqual({ ok: false, error: "mutation_conflict" });
    });

    it("the HTTP endpoint rejects out-of-range points and other roles", async () => {
      const post = (body: unknown) =>
        driverSyncResponse(
          new Request("http://localhost/api/driver/sync", {
            method: "POST",
            headers: { "content-type": "application/json", origin: "http://localhost" },
            body: JSON.stringify(body),
          }),
          SERVER_NOW,
        );
      state.session = { user: { id: driverId } };
      expect((await post({ entries: [entry({ lat: 95 })] })).status).toBe(400);
      expect((await post({ entries: [entry()] })).status).toBe(200);
      expect(await spots()).toHaveLength(1);
      state.session = { user: { id: adminId } };
      expect((await post({ entries: [entry()] })).status).toBe(403);
    });
  },
);
