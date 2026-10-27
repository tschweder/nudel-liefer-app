// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { requireDepot } from "@/domain/settings";

import { LocalHeuristicProvider, type OptimizeInput, type RoutingProvider } from "./routing";
import { createTestDb, type TestDb } from "./test-db";

vi.mock("next/cache", () => ({ updateTag: vi.fn(), cacheTag: vi.fn(), cacheLife: vi.fn() }));

const { generateTourWith } = await import("./tour-builder");
const { getTourPlan } = await import("./tour-planning");

const DAY = new Date("2099-07-01T00:00:00Z");
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

describe.skipIf(!process.env.DATABASE_URL)(
  "time windows on a tour (NUD-148)",
  { timeout: 60_000 },
  () => {
    let t: TestDb;
    let adminId: string;
    let productId: string;
    let customerId: string;
    const optimizeInputs: OptimizeInput[] = [];
    const heuristic = new LocalHeuristicProvider();
    const provider: RoutingProvider = {
      optimize: (input) => {
        optimizeInputs.push(input);
        return heuristic.optimize(input);
      },
      route: (input) => heuristic.route(input),
      distribute: (input) => heuristic.distribute(input),
    };

    const generate = (departureTime: string) =>
      generateTourWith(
        {
          db: t.prisma,
          actorId: adminId,
          provider,
          requireDepot: async () => requireDepot({ ...SETTINGS, depotPinConfirmed: true }),
          loadSettings: async () => ({ ...SETTINGS, departureTime }),
          now: () => NOW,
        },
        DAY,
      );
    const placeOrder = (fromTime: string | null, toTime: string | null) =>
      t.prisma.order.create({
        data: {
          customerId,
          deliveryDate: DAY,
          windowFrom: DAY,
          windowTo: DAY,
          windowFromTime: fromTime,
          windowToTime: toTime,
          status: "CONFIRMED",
          createdById: adminId,
          items: { create: [{ productId, quantity: 1 }] },
        },
      });
    const stopOf = async () => {
      const plan = await getTourPlan(t.prisma, "2099-07-01", "Europe/Vienna");
      return plan!.tour!.stops[0]!;
    };

    beforeAll(async () => {
      t = await createTestDb();
      adminId = (
        await t.prisma.user.create({
          data: { role: "ADMIN", email: "a@example.com", passwordHash: "x", displayName: "A" },
        })
      ).id;
      customerId = (
        await t.prisma.customer.create({
          data: {
            customerNumber: "C1",
            name: "Kunde 1",
            street: "Hauptstraße 1",
            postalCode: "1010",
            city: "Wien",
            lat: DEPOT.lat,
            lng: DEPOT.lng + 0.1,
          },
        })
      ).id;
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
      optimizeInputs.length = 0;
      await t.prisma.stopOrder.deleteMany();
      await t.prisma.stop.deleteMany();
      await t.prisma.tour.deleteMany();
      await t.prisma.order.deleteMany();
    });

    it("window 08:00-11:00, ETA inside: no warning; the optimiser got the window", async () => {
      await placeOrder("08:00", "11:00");
      expect((await generate("08:00")).ok).toBe(true);
      const stop = await stopOf();
      expect(stop.timeWindow).toEqual({ from: "08:00", to: "11:00" });
      expect(stop.windowIssue).toBeNull();
      expect(optimizeInputs[0]?.departureS).toBe(8 * 3600);
      expect(optimizeInputs[0]?.stops[0]?.timeWindow).toEqual({ fromS: 8 * 3600, toS: 11 * 3600 });
    });

    it("ETA before the window: warning 'early'", async () => {
      await placeOrder("08:00", "11:00");
      expect((await generate("06:00")).ok).toBe(true);
      expect((await stopOf()).windowIssue).toBe("early");
    });

    it("ETA after the window: warning 'late'", async () => {
      await placeOrder("08:00", "09:00");
      expect((await generate("10:00")).ok).toBe(true);
      expect((await stopOf()).windowIssue).toBe("late");
    });

    it("two orders with disjoint hours at one stop: 'conflict'", async () => {
      await placeOrder("08:00", "09:00");
      await placeOrder("13:00", "14:00");
      expect((await generate("08:00")).ok).toBe(true);
      expect((await stopOf()).windowIssue).toBe("conflict");
    });

    it("an order without hours has no window on the stop", async () => {
      await placeOrder(null, null);
      expect((await generate("08:00")).ok).toBe(true);
      const stop = await stopOf();
      expect(stop.timeWindow).toBeNull();
      expect(stop.windowIssue).toBeNull();
      expect(optimizeInputs[0]?.stops[0]?.timeWindow).toBeUndefined();
    });
  },
);
