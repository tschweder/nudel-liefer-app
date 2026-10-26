// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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

const actions = await import("./parking-actions");
const { parkingSpotsQuery } = await import("./customer-queries");
const { AuthorizationError } = await import("./auth/actor");

describe.skipIf(!process.env.DATABASE_URL)("parking spots (office)", { timeout: 60_000 }, () => {
  let t: TestDb;
  let adminId: string;
  let driverId: string;
  const base = { street: "Teststraße 1", postalCode: "1010", city: "Wien" };
  let n = 0;
  const mkCustomer = async () =>
    (
      await t.prisma.customer.create({
        data: { customerNumber: `PK-${++n}`, name: `Kunde ${n}`, ...base },
      })
    ).id;
  const asAdmin = () => {
    state.session = { user: { id: adminId } };
  };
  const spot = (customerId: string, extra: Record<string, unknown> = {}) => ({
    customerId,
    label: "Hof",
    note: "Einfahrt links",
    lat: 48.2082,
    lng: 16.3738,
    ...extra,
  });
  const audit = (customerId: string) =>
    t.prisma.auditLog.findMany({
      where: { entity: "Customer", entityId: customerId, action: { startsWith: "parking." } },
      orderBy: { createdAt: "asc" },
    });

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
        data: { role: "DRIVER", username: "drv", passwordHash: hash, displayName: "D" },
      })
    ).id;
  }, 60_000);
  afterAll(async () => {
    await t?.teardown();
  });
  beforeEach(() => {
    state.session = null;
  });

  it("rejects anonymous and driver callers before touching anything", async () => {
    const customerId = await mkCustomer();
    for (const session of [null, { user: { id: driverId } }]) {
      state.session = session;
      await expect(actions.createParkingSpotAction(spot(customerId))).rejects.toBeInstanceOf(
        AuthorizationError,
      );
      await expect(
        actions.updateParkingSpotAction({ id: "x", lat: 1, lng: 1 }),
      ).rejects.toBeInstanceOf(AuthorizationError);
      await expect(
        actions.reorderParkingSpotsAction({ customerId, ids: ["x"] }),
      ).rejects.toBeInstanceOf(AuthorizationError);
      await expect(actions.deactivateParkingSpotAction({ id: "x" })).rejects.toBeInstanceOf(
        AuthorizationError,
      );
      await expect(parkingSpotsQuery(customerId)).rejects.toBeInstanceOf(AuthorizationError);
    }
    expect(await t.prisma.parkingSpot.count({ where: { customerId } })).toBe(0);
  });

  it("creates spots in order; the first is the default; every write is audited", async () => {
    const customerId = await mkCustomer();
    asAdmin();
    const a = await actions.createParkingSpotAction(spot(customerId, { label: "A" }));
    const b = await actions.createParkingSpotAction(
      spot(customerId, { label: "B", note: "  ", lat: 48.123456789 }),
    );
    expect(a.ok && b.ok).toBe(true);
    const list = await parkingSpotsQuery(customerId);
    expect(list.map((s) => [s.label, s.isDefault])).toEqual([
      ["A", true],
      ["B", false],
    ]);
    expect(list[1]).toMatchObject({ note: null, lat: 48.123457 });
    const log = await audit(customerId);
    expect(log.map((l) => l.action)).toEqual(["parking.create", "parking.create"]);
    expect(log.every((l) => l.actorId === adminId)).toBe(true);
    expect(log[0]!.diff).toMatchObject({ isDefault: true });
    expect(log[1]!.diff).toMatchObject({ isDefault: false });
  });

  it("validates input and refuses unknown customers", async () => {
    const customerId = await mkCustomer();
    asAdmin();
    const bad = [
      spot(customerId, { lat: 91 }),
      spot(customerId, { lng: -181 }),
      spot(customerId, { label: "x".repeat(81) }),
      spot(customerId, { note: "x".repeat(501) }),
      spot("", {}),
      { ...spot(customerId), lat: "48" },
    ];
    for (const input of bad) {
      expect(await actions.createParkingSpotAction(input), JSON.stringify(input)).toEqual({
        ok: false,
        error: "invalid",
      });
    }
    expect(await actions.createParkingSpotAction(spot("nope"))).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await t.prisma.parkingSpot.count({ where: { customerId } })).toBe(0);
    expect(await audit(customerId)).toEqual([]);
  });

  it("limits the number of active spots", async () => {
    const customerId = await mkCustomer();
    asAdmin();
    for (let i = 0; i < 10; i++) {
      expect((await actions.createParkingSpotAction(spot(customerId))).ok).toBe(true);
    }
    expect(await actions.createParkingSpotAction(spot(customerId))).toEqual({
      ok: false,
      error: "limit",
    });
  });

  it("edits label, note and position and audits only what changed (no free text)", async () => {
    const customerId = await mkCustomer();
    asAdmin();
    const created = await actions.createParkingSpotAction(spot(customerId));
    const id = created.ok ? created.spotId! : "";
    expect(
      await actions.updateParkingSpotAction({
        id,
        label: "Hof hinten",
        note: "Tor 2",
        lat: 48.21,
        lng: 16.37,
      }),
    ).toEqual({ ok: true, spotId: id });
    const row = await t.prisma.parkingSpot.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ label: "Hof hinten", note: "Tor 2", lat: 48.21, lng: 16.37 });
    const log = await audit(customerId);
    expect(log.at(-1)!.action).toBe("parking.update");
    expect(log.at(-1)!.diff).toMatchObject({
      spotId: id,
      fields: ["label", "note", "coordinates"],
    });
    expect(JSON.stringify(log.at(-1)!.diff)).not.toContain("Tor 2");
    // Saving the same values again is a no-op without a new entry.
    await actions.updateParkingSpotAction({
      id,
      label: "Hof hinten",
      note: "Tor 2",
      lat: 48.21,
      lng: 16.37,
    });
    expect((await audit(customerId)).length).toBe(log.length);
  });

  it("reorders the active spots; the first becomes the default", async () => {
    const customerId = await mkCustomer();
    asAdmin();
    const ids: string[] = [];
    for (const label of ["A", "B", "C"]) {
      const r = await actions.createParkingSpotAction(spot(customerId, { label }));
      ids.push(r.ok ? r.spotId! : "");
    }
    expect(
      await actions.reorderParkingSpotsAction({ customerId, ids: [ids[2]!, ids[0]!, ids[1]!] }),
    ).toEqual({ ok: true });
    const list = await parkingSpotsQuery(customerId);
    expect(list.map((s) => [s.label, s.isDefault])).toEqual([
      ["C", true],
      ["A", false],
      ["B", false],
    ]);
    expect((await audit(customerId)).at(-1)).toMatchObject({ action: "parking.reorder" });
    // Incomplete, foreign or duplicated lists are refused and change nothing.
    expect(await actions.reorderParkingSpotsAction({ customerId, ids: [ids[0]!] })).toEqual({
      ok: false,
      error: "conflict",
    });
    expect(
      await actions.reorderParkingSpotsAction({ customerId, ids: [ids[0]!, ids[0]!, ids[1]!] }),
    ).toEqual({ ok: false, error: "invalid" });
    expect((await parkingSpotsQuery(customerId)).map((s) => s.label)).toEqual(["C", "A", "B"]);
  });

  it("deactivates (soft delete); the next active spot becomes the default", async () => {
    const customerId = await mkCustomer();
    asAdmin();
    const first = await actions.createParkingSpotAction(spot(customerId, { label: "A" }));
    await actions.createParkingSpotAction(spot(customerId, { label: "B" }));
    const id = first.ok ? first.spotId! : "";
    expect(await actions.deactivateParkingSpotAction({ id })).toEqual({ ok: true, spotId: id });
    const list = await parkingSpotsQuery(customerId);
    expect(list.map((s) => [s.label, s.isDefault])).toEqual([["B", true]]);
    // The row is still there.
    expect((await t.prisma.parkingSpot.findUniqueOrThrow({ where: { id } })).active).toBe(false);
    expect((await audit(customerId)).at(-1)!.diff).toMatchObject({ spotId: id, wasDefault: true });
    // A deactivated spot cannot be edited or deactivated again.
    expect(await actions.deactivateParkingSpotAction({ id })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await actions.updateParkingSpotAction({ id, label: "x", lat: 1, lng: 1 })).toEqual({
      ok: false,
      error: "not_found",
    });
    // A new spot goes behind every earlier one, inactive ones included.
    await actions.createParkingSpotAction(spot(customerId, { label: "C" }));
    expect((await parkingSpotsQuery(customerId)).map((s) => s.label)).toEqual(["B", "C"]);
  });
});
