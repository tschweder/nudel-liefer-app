// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  toDriverOtherTours,
  toDriverStopDetail,
  toDriverToday,
  tourPhotos,
} from "@/lib/driver-tour-model";

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

const { getDriverTour, getDriverTours } = await import("./tour-driver");
const { getDriverTourResponse } = await import("./driver-tour-payload");

// 22:30 UTC on 1 July is already 2 July in Vienna: "today" is the factory's calendar day.
const NOW = new Date("2099-07-01T22:30:00Z");
const DAY = "2099-07-02";
const OPTIONS = { now: NOW, timezone: "Europe/Vienna", serviceMinutesPerStop: 10 };
const text = (de: string) => ({
  de,
  meta: { source: "de", machine: {}, updatedAt: "2099-01-01T00:00:00Z" },
});

/**
 * NUD-163: two *open* tours of the same driver on the same day (D29 "+ Tour", D31 reloads). The
 * driver must reach the pending stops of both, so the read model returns every open tour and the
 * payload carries them all.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  "driver with two open tours (NUD-163)",
  { timeout: 60_000 },
  () => {
    let t: TestDb;
    let driverId: string;
    let firstTourId: string;
    let secondTourId: string;
    let firstStopId: string;
    let secondStopId: string;

    beforeAll(async () => {
      t = await createTestDb();
      state.db = t.prisma;
      const hash = await hashSecret("123456");
      const user = (data: Record<string, unknown>) =>
        t.prisma.user.create({ data: { passwordHash: hash, ...data } as never }).then((u) => u.id);
      driverId = await user({ role: "DRIVER", username: "drv", displayName: "Driver" });

      const product = await t.prisma.product.create({
        data: { sku: "SPAG", unit: "KG", weightKgPerUnit: 1, name: text("Spaghetti") },
      });
      const customer = async (number: string, name: string) =>
        t.prisma.customer.create({
          data: {
            customerNumber: number,
            name,
            street: "Hauptstraße 1",
            postalCode: "1010",
            city: "Wien",
            lat: 48.2,
            lng: 16.3,
            pinConfirmed: true,
          },
        });
      const first = await customer("K1", "Trattoria 1");
      const second = await customer("K2", "Trattoria 2");

      const mkTour = async (createdAt: string) =>
        t.prisma.tour.create({
          data: {
            date: new Date(`${DAY}T00:00:00Z`),
            driverId,
            status: "RELEASED",
            releaseRevision: 1,
            createdAt: new Date(createdAt),
            depotSnapshot: { name: "Depot", address: "x", lat: 48.2, lng: 16.3 },
          },
        });
      // Tour 1 was created first (it is the older, "Tour 1"), tour 2 the follow-up of the day.
      const firstTour = await mkTour("2099-07-02T04:00:00Z");
      const secondTour = await mkTour("2099-07-02T04:30:00Z");
      firstTourId = firstTour.id;
      secondTourId = secondTour.id;

      firstStopId = (
        await t.prisma.stop.create({
          data: {
            tourId: firstTour.id,
            customerId: first.id,
            sequence: 1,
            items: [{ productId: product.id, quantity: 3 }],
          },
        })
      ).id;
      secondStopId = (
        await t.prisma.stop.create({
          data: {
            tourId: secondTour.id,
            customerId: second.id,
            sequence: 1,
            items: [{ productId: product.id, quantity: 5 }],
          },
        })
      ).id;
    });

    afterAll(async () => {
      await t?.teardown();
    });

    const actor = () => ({ id: driverId, role: "DRIVER" as const, locale: "de" as const });

    it("returns every open tour of the day, oldest first, with its position", async () => {
      const tours = await getDriverTours(t.prisma, driverId, DAY);
      expect(tours.map((tour) => tour.id)).toEqual([firstTourId, secondTourId]);
      expect(tours.map((tour) => tour.tourNumber)).toEqual([1, 2]);
      expect(tours.every((tour) => tour.tourCount === 2)).toBe(true);
      expect(tours.map((tour) => tour.stops.map((s) => s.id))).toEqual([
        [firstStopId],
        [secondStopId],
      ]);
    });

    it("keeps the newest open tour as the single 'active' tour", async () => {
      expect((await getDriverTour(t.prisma, driverId, DAY))?.id).toBe(secondTourId);
    });

    it("carries both tours in the driver payload, the active one also in `tour`", async () => {
      const response = await getDriverTourResponse(t.prisma, actor(), OPTIONS);
      expect(response.tours.map((tour) => tour.id)).toEqual([firstTourId, secondTourId]);
      expect(response.tour?.id).toBe(secondTourId);
      const today = toDriverToday(response, "de")!;
      expect(today.tourId).toBe(secondTourId);
      const others = toDriverOtherTours(response, "de");
      expect(others.map((tour) => tour.tourId)).toEqual([firstTourId]);
      expect(others[0]!.stops.map((s) => s.id)).toEqual([firstStopId]);
    });

    it("opens the stop detail of a stop of the other open tour", async () => {
      const storage = new FakeStorage();
      const response = await getDriverTourResponse(t.prisma, actor(), {
        ...OPTIONS,
        photos: { storage, onlyStopId: firstStopId },
      });
      const detail = toDriverStopDetail(response, firstStopId, "de")!;
      expect(detail).toMatchObject({ tourId: firstTourId, position: 1, total: 1 });
      expect(detail.stop.items.map((item) => item.quantity)).toEqual([3]);
      // The active tour's stop is reachable the same way.
      expect(toDriverStopDetail(response, secondStopId, "de")).toMatchObject({
        tourId: secondTourId,
        position: 1,
      });
      // A stop that is in no tour of the day stays unknown.
      expect(toDriverStopDetail(response, "nope", "de")).toBeNull();
    });

    it("prefetches the photos of every open tour (none here, but never a duplicate)", async () => {
      const response = await getDriverTourResponse(t.prisma, actor(), OPTIONS);
      expect(tourPhotos(response)).toEqual([]);
    });

    it("drops a completed tour from the list and keeps only the open one", async () => {
      await t.prisma.tour.update({ where: { id: firstTourId }, data: { status: "COMPLETED" } });
      const response = await getDriverTourResponse(t.prisma, actor(), OPTIONS);
      expect(response.tours.map((tour) => tour.id)).toEqual([secondTourId]);
      expect(toDriverOtherTours(response, "de")).toEqual([]);
      await t.prisma.tour.update({ where: { id: firstTourId }, data: { status: "RELEASED" } });
    });
  },
);
