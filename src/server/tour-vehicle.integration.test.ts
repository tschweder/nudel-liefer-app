// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { requireDepot } from "@/domain/settings";

import { hashSecret } from "./auth/password";
import { LocalHeuristicProvider, setRoutingProviderForTests } from "./routing";
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
const { editTourWith } = await import("./tour-edit");
const { getTourPlan, releaseTourWith } = await import("./tour-planning");
const tourActions = await import("./tour-actions");
const vehicleActions = await import("./vehicle-actions");

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

/** Three stops with one unit each; a unit weighs 10 kg, so the tour carries 30 kg. */
const LOAD_KG = 30;

describe.skipIf(!process.env.DATABASE_URL)("tour vehicle and load", { timeout: 60_000 }, () => {
  let t: TestDb;
  let adminId: string;
  let driverId: string;
  let productId: string;
  const provider = new LocalHeuristicProvider();
  const deps = () => ({
    db: t.prisma,
    actorId: adminId,
    provider,
    loadSettings: async () => SETTINGS,
  });
  const vehicle = (capacityKg: number, extra: Record<string, unknown> = {}) =>
    t.prisma.vehicle
      .create({ data: { name: `Van ${capacityKg} ${Math.random()}`, capacityKg, ...extra } })
      .then((v) => v.id);
  const version = async (id: string) =>
    (await t.prisma.tour.findUniqueOrThrow({ where: { id } })).updatedAt.toISOString();
  const audit = (entityId: string) =>
    t.prisma.auditLog.findMany({ where: { entityId }, orderBy: { createdAt: "asc" } });

  async function buildTour() {
    const ids: string[] = [];
    for (const [n, off] of [
      ["C1", 0.1],
      ["C2", 0.2],
      ["C3", 0.3],
    ] as const) {
      const c = await t.prisma.customer.create({
        data: {
          customerNumber: n,
          name: `Kunde ${n}`,
          street: "Hauptstraße 1",
          postalCode: "1010",
          city: "Wien",
          lat: DEPOT.lat,
          lng: DEPOT.lng + off,
        },
      });
      ids.push(c.id);
      await t.prisma.order.create({
        data: {
          customerId: c.id,
          deliveryDate: DAY,
          status: "CONFIRMED",
          createdById: adminId,
          items: { create: [{ productId, quantity: 1 }] },
        },
      });
    }
    const result = await generateTourWith(
      {
        db: t.prisma,
        actorId: adminId,
        provider,
        requireDepot: async () => requireDepot({ ...SETTINGS, depotPinConfirmed: true }),
        loadSettings: async () => SETTINGS,
        now: () => NOW,
      },
      DAY,
    );
    if (!result.ok) throw new Error(`generate failed: ${result.error}`);
    await t.prisma.tour.update({ where: { id: result.tourId }, data: { driverId } });
    return result.tourId;
  }

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
        data: { role: "DRIVER", username: "drv", passwordHash: hash, displayName: "Driver" },
      })
    ).id;
    productId = (
      await t.prisma.product.create({
        data: {
          sku: "P1",
          unit: "CRATE",
          weightKgPerUnit: 10,
          name: { de: "P1", meta: { source: "de", machine: {} } },
        },
      })
    ).id;
  }, 60_000);
  afterAll(async () => {
    await t?.teardown();
  });
  beforeEach(async () => {
    state.session = { user: { id: adminId } };
    setRoutingProviderForTests(provider);
    await t.prisma.settings.deleteMany();
    await t.prisma.settings.create({ data: { id: 1, ...SETTINGS, depotPinConfirmed: true } });
    await t.prisma.tour.deleteMany();
    await t.prisma.orderItem.deleteMany();
    await t.prisma.order.deleteMany();
    await t.prisma.photo.deleteMany();
    await t.prisma.parkingSpot.deleteMany();
    await t.prisma.customer.deleteMany();
    await t.prisma.vehicle.deleteMany();
  });

  describe("assign a vehicle", () => {
    it("assigns, changes and clears it, with one audit entry per change and none for a no-op", async () => {
      const tourId = await buildTour();
      const a = await vehicle(100);
      const b = await vehicle(200);
      expect(await tourActions.assignVehicleAction({ tourId, vehicleId: a })).toEqual({ ok: true });
      expect(await tourActions.assignVehicleAction({ tourId, vehicleId: a })).toEqual({ ok: true });
      expect(await tourActions.assignVehicleAction({ tourId, vehicleId: b })).toEqual({ ok: true });
      expect(await tourActions.assignVehicleAction({ tourId, vehicleId: null })).toEqual({
        ok: true,
      });
      const rows = (await audit(tourId)).filter((r) => r.action === "tour.assign_vehicle");
      expect(rows.map((r) => r.diff)).toEqual([
        { vehicleId: { from: null, to: a } },
        { vehicleId: { from: a, to: b } },
        { vehicleId: { from: b, to: null } },
      ]);
      expect(rows.every((r) => r.actorId === adminId)).toBe(true);
    });

    it("refuses an unknown or deactivated vehicle, a released tour and bad input", async () => {
      const tourId = await buildTour();
      const gone = await vehicle(100, { active: false });
      expect(await tourActions.assignVehicleAction({ tourId, vehicleId: "nope" })).toEqual({
        ok: false,
        error: "vehicle_invalid",
      });
      expect(await tourActions.assignVehicleAction({ tourId, vehicleId: gone })).toEqual({
        ok: false,
        error: "vehicle_invalid",
      });
      expect(await tourActions.assignVehicleAction({ tourId, extra: 1 })).toEqual({
        ok: false,
        error: "invalid",
      });
      expect(
        await tourActions.assignVehicleAction({ tourId: "x".repeat(65), vehicleId: null }),
      ).toEqual({
        ok: false,
        error: "invalid",
      });
      const ok = await vehicle(100);
      await t.prisma.tour.update({ where: { id: tourId }, data: { status: "RELEASED" } });
      expect(await tourActions.assignVehicleAction({ tourId, vehicleId: ok })).toEqual({
        ok: false,
        error: "tour_not_editable",
      });
    });
  });

  describe("release", () => {
    it("needs a vehicle, and an active one", async () => {
      const tourId = await buildTour();
      expect(
        await releaseTourWith(t.prisma, adminId, { tourId, version: await version(tourId) }),
      ).toEqual({
        ok: false,
        error: "vehicle_required",
      });
      const gone = await vehicle(100, { active: false });
      await t.prisma.tour.update({ where: { id: tourId }, data: { vehicleId: gone } });
      expect(
        await releaseTourWith(t.prisma, adminId, { tourId, version: await version(tourId) }),
      ).toEqual({
        ok: false,
        error: "vehicle_invalid",
      });
      expect((await t.prisma.tour.findUniqueOrThrow({ where: { id: tourId } })).status).toBe(
        "OPTIMIZED",
      );
    });

    it("releases a load that fits, also exactly at the capacity, without an override entry", async () => {
      const tourId = await buildTour();
      await t.prisma.tour.update({
        where: { id: tourId },
        data: { vehicleId: await vehicle(LOAD_KG) },
      });
      const result = await releaseTourWith(t.prisma, adminId, {
        tourId,
        version: await version(tourId),
        overrideOverload: true, // not needed, so it must not be recorded
      });
      expect(result).toMatchObject({ ok: true, stopCount: 3 });
      const release = (await audit(tourId)).find((r) => r.action === "tour.release")!;
      expect(release.diff).not.toHaveProperty("overloadOverride");
    });

    it("refuses an overloaded tour without the override and changes nothing", async () => {
      const tourId = await buildTour();
      const small = await vehicle(LOAD_KG - 5);
      await t.prisma.tour.update({ where: { id: tourId }, data: { vehicleId: small } });
      for (const input of [{}, { overrideOverload: false }]) {
        expect(
          await releaseTourWith(t.prisma, adminId, {
            tourId,
            version: await version(tourId),
            ...input,
          }),
        ).toEqual({ ok: false, error: "overloaded" });
      }
      const after = await t.prisma.tour.findUniqueOrThrow({ where: { id: tourId } });
      expect(after.status).toBe("OPTIMIZED");
      expect(after.releasedAt).toBeNull();
      expect((await audit(tourId)).some((r) => r.action === "tour.release")).toBe(false);
    });

    it("releases an overloaded tour with the explicit override and logs it", async () => {
      const tourId = await buildTour();
      const small = await vehicle(LOAD_KG - 5);
      await t.prisma.tour.update({ where: { id: tourId }, data: { vehicleId: small } });
      const result = await tourActions.releaseTourAction({
        tourId,
        version: await version(tourId),
        overrideOverload: true,
      });
      expect(result).toMatchObject({ ok: true });
      expect((await t.prisma.tour.findUniqueOrThrow({ where: { id: tourId } })).status).toBe(
        "RELEASED",
      );
      const release = (await audit(tourId)).find((r) => r.action === "tour.release")!;
      expect(release.diff).toMatchObject({
        overloadOverride: true,
        loadKg: LOAD_KG,
        capacityKg: LOAD_KG - 5,
        vehicleId: small,
        driverId,
      });
      expect(release.actorId).toBe(adminId);
    });

    it("rejects a non-boolean override", async () => {
      const tourId = await buildTour();
      expect(
        await tourActions.releaseTourAction({
          tourId,
          version: await version(tourId),
          overrideOverload: "yes",
        }),
      ).toEqual({ ok: false, error: "invalid" });
    });
  });

  describe("plan read model", () => {
    it("carries the load, the vehicle and the selectable vehicles", async () => {
      const tourId = await buildTour();
      const active = await vehicle(500);
      const inactiveAssigned = await vehicle(300, { active: false });
      await vehicle(400, { active: false }); // inactive and not assigned: not offered
      await t.prisma.tour.update({ where: { id: tourId }, data: { vehicleId: inactiveAssigned } });
      const plan = await getTourPlan(t.prisma, "2099-07-01", "Europe/Vienna");
      expect(plan?.tour).toMatchObject({ vehicleId: inactiveAssigned, loadKg: LOAD_KG });
      expect(plan?.vehicles.map((v) => v.id).sort()).toEqual([active, inactiveAssigned].sort());
    });

    it("counts the snapshot quantities of the stops, not the live order lines", async () => {
      const tourId = await buildTour();
      await t.prisma.orderItem.updateMany({ data: { quantity: 9 } });
      expect((await getTourPlan(t.prisma, "2099-07-01", "Europe/Vienna"))?.tour?.loadKg).toBe(
        LOAD_KG,
      );
      expect(tourId).toBeTruthy();
    });
  });

  describe("Bearbeiten", () => {
    async function edit(tourId: string, vehicleId: string | null | undefined) {
      const stops = await t.prisma.stop.findMany({
        where: { tourId },
        orderBy: { sequence: "asc" },
      });
      return editTourWith(deps(), {
        tourId,
        version: await version(tourId),
        driverId,
        ...(vehicleId === undefined ? {} : { vehicleId }),
        orderedStopIds: stops.map((s) => s.id),
        moves: [],
      });
    }

    it("sets the vehicle of an unreleased tour and audits it; omitted means unchanged", async () => {
      const tourId = await buildTour();
      const a = await vehicle(100);
      expect(await edit(tourId, a)).toMatchObject({ ok: true, changed: true });
      expect((await t.prisma.tour.findUniqueOrThrow({ where: { id: tourId } })).vehicleId).toBe(a);
      expect(await edit(tourId, undefined)).toMatchObject({ ok: true, changed: false });
      expect(await edit(tourId, a)).toMatchObject({ ok: true, changed: false });
      expect((await audit(tourId)).filter((r) => r.action === "tour.assign_vehicle")).toHaveLength(
        1,
      );
    });

    it("changes the vehicle of a released tour through the 'tour updated' path", async () => {
      const tourId = await buildTour();
      const a = await vehicle(100);
      const b = await vehicle(200);
      await t.prisma.tour.update({
        where: { id: tourId },
        data: { vehicleId: a, status: "RELEASED", releasedAt: NOW, releaseRevision: 1 },
      });
      const result = await edit(tourId, b);
      expect(result).toMatchObject({ ok: true, changed: true, revision: 2 });
      const tour = await t.prisma.tour.findUniqueOrThrow({ where: { id: tourId } });
      expect(tour).toMatchObject({ vehicleId: b, releaseRevision: 2, status: "RELEASED" });
      expect(tour.reReleasedAt).not.toBeNull();
    });

    it("refuses an inactive vehicle, and a released tour cannot lose its vehicle", async () => {
      const tourId = await buildTour();
      const gone = await vehicle(100, { active: false });
      expect(await edit(tourId, gone)).toEqual({ ok: false, error: "vehicle_invalid" });
      expect(await edit(tourId, "nope")).toEqual({ ok: false, error: "vehicle_invalid" });
      const a = await vehicle(100);
      await t.prisma.tour.update({
        where: { id: tourId },
        data: { vehicleId: a, status: "RELEASED", releasedAt: NOW, releaseRevision: 1 },
      });
      expect(await edit(tourId, null)).toEqual({ ok: false, error: "vehicle_required" });
    });

    it("lets an old released tour without a vehicle stay without one", async () => {
      const tourId = await buildTour();
      await t.prisma.tour.update({
        where: { id: tourId },
        data: { status: "RELEASED", releasedAt: NOW, releaseRevision: 1 },
      });
      expect(await edit(tourId, null)).toMatchObject({ ok: true, changed: false });
    });
  });

  describe("vehicle master data", () => {
    const entries = (entityId: string) =>
      t.prisma.auditLog.findMany({
        where: { entity: "Vehicle", entityId },
        orderBy: { createdAt: "asc" },
      });

    it("creates and edits a vehicle with audit entries; an unchanged save writes none", async () => {
      const created = await vehicleActions.createVehicleAction({
        name: " Sprinter ",
        plate: "W-1 AB",
        capacityKg: "1.200".replace(".", ""),
      });
      if (!created.ok) throw new Error(created.error);
      expect(await t.prisma.vehicle.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject(
        {
          name: "Sprinter",
          plate: "W-1 AB",
          capacityKg: 1200,
          active: true,
        },
      );
      await vehicleActions.updateVehicleAction(created.id, {
        name: "Sprinter",
        plate: "W-1 AB",
        capacityKg: 1200,
      });
      expect(
        await vehicleActions.updateVehicleAction(created.id, {
          name: "Sprinter 2",
          plate: "",
          capacityKg: "900",
        }),
      ).toEqual({ ok: true, id: created.id });
      expect(await t.prisma.vehicle.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject(
        {
          name: "Sprinter 2",
          plate: null,
          capacityKg: 900,
        },
      );
      const rows = await entries(created.id);
      expect(rows.map((r) => r.action)).toEqual(["vehicle.create", "vehicle.update"]);
      expect(rows[1]!.diff).toEqual({
        name: { from: "Sprinter", to: "Sprinter 2" },
        plate: { from: "W-1 AB", to: null },
        capacityKg: { from: 1200, to: 900 },
      });
    });

    it("refuses bad capacity, empty or too long names, unknown keys and duplicate names", async () => {
      for (const capacityKg of ["0", "12.5", "12,5", "-1", "abc", "", "50001", 0, 1.5]) {
        expect(await vehicleActions.createVehicleAction({ name: "X", capacityKg })).toEqual({
          ok: false,
          error: "invalid",
        });
      }
      for (const input of [
        { name: "", capacityKg: 10 },
        { name: "   ", capacityKg: 10 },
        { name: "N".repeat(81), capacityKg: 10 },
        { name: "X", plate: "P".repeat(21), capacityKg: 10 },
        { name: "X", capacityKg: 10, active: false },
      ]) {
        expect(await vehicleActions.createVehicleAction(input)).toEqual({
          ok: false,
          error: "invalid",
        });
      }
      expect(await t.prisma.vehicle.count()).toBe(0);
      const first = await vehicleActions.createVehicleAction({ name: "Van", capacityKg: 10 });
      expect(await vehicleActions.createVehicleAction({ name: " van ", capacityKg: 10 })).toEqual({
        ok: false,
        error: "name_taken",
      });
      const second = await vehicleActions.createVehicleAction({ name: "Bus", capacityKg: 10 });
      if (!first.ok || !second.ok) throw new Error("create failed");
      expect(
        await vehicleActions.updateVehicleAction(second.id, { name: "VAN", capacityKg: 10 }),
      ).toEqual({ ok: false, error: "name_taken" });
      expect(
        await vehicleActions.updateVehicleAction("nope", { name: "Q", capacityKg: 1 }),
      ).toEqual({
        ok: false,
        error: "not_found",
      });
    });

    it("deactivates and reactivates (soft delete) and keeps the vehicle on its tours", async () => {
      const tourId = await buildTour();
      const created = await vehicleActions.createVehicleAction({ name: "Van", capacityKg: 100 });
      if (!created.ok) throw new Error(created.error);
      await t.prisma.tour.update({ where: { id: tourId }, data: { vehicleId: created.id } });
      expect(await vehicleActions.setVehicleActiveAction(created.id, false)).toEqual({ ok: true });
      expect(await vehicleActions.setVehicleActiveAction(created.id, false)).toEqual({ ok: true });
      expect((await t.prisma.vehicle.findUniqueOrThrow({ where: { id: created.id } })).active).toBe(
        false,
      );
      expect((await t.prisma.tour.findUniqueOrThrow({ where: { id: tourId } })).vehicleId).toBe(
        created.id,
      );
      expect(await vehicleActions.setVehicleActiveAction(created.id, true)).toEqual({ ok: true });
      expect((await entries(created.id)).map((r) => r.action)).toEqual([
        "vehicle.create",
        "vehicle.deactivate",
        "vehicle.activate",
      ]);
      expect(await vehicleActions.setVehicleActiveAction("nope", true)).toEqual({
        ok: false,
        error: "not_found",
      });
      expect(await vehicleActions.setVehicleActiveAction(created.id, "no")).toEqual({
        ok: false,
        error: "invalid",
      });
    });
  });
});
