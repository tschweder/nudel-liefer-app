// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hashSecret } from "./auth/password";
import { createTestDb, type TestDb } from "./test-db";

const state: { session: { user?: { id: string } } | null; db: TestDb["prisma"] | null } = {
  session: null,
  db: null,
};
const updateTag = vi.fn();
vi.mock("next/cache", () => ({ updateTag, cacheTag: vi.fn(), cacheLife: vi.fn() }));
vi.mock("./auth/auth", () => ({ auth: async () => state.session }));
vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  getDb: () => state.db,
}));

const { saveSettingsAction } = await import("./settings-actions");
const { readSettings } = await import("./settings");
const { getDepot } = await import("@/domain/settings");

const valid = {
  depotName: "Nudelfabrik",
  depotAddress: "Graben 1, 1010 Wien",
  depotLat: 48.2082123456,
  depotLng: 16.3738,
  depotPinConfirmed: true,
  timezone: "Europe/Vienna",
  departureTime: "06:30",
  serviceMinutesPerStop: 12,
  deliveryWeekdays: [5, 2, 2, 1],
};

describe.skipIf(!process.env.DATABASE_URL)("saveSettingsAction", { timeout: 60_000 }, () => {
  let t: TestDb;
  let adminId: string;
  let driverId: string;
  let inactiveAdminId: string;

  beforeAll(async () => {
    t = await createTestDb();
    state.db = t.prisma;
    const hash = await hashSecret("123456");
    const mk = (data: Parameters<typeof t.prisma.user.create>[0]["data"]) =>
      t.prisma.user.create({ data }).then((u) => u.id);
    adminId = await mk({
      role: "ADMIN",
      email: "a@example.com",
      passwordHash: hash,
      displayName: "A",
    });
    driverId = await mk({ role: "DRIVER", username: "drv", passwordHash: hash, displayName: "D" });
    inactiveAdminId = await mk({
      role: "ADMIN",
      email: "i@example.com",
      passwordHash: hash,
      displayName: "I",
      active: false,
    });
  }, 60_000);

  afterAll(async () => {
    await t?.teardown();
  });

  beforeEach(() => {
    state.session = null;
    updateTag.mockClear();
  });

  it("rejects anonymous callers, drivers and deactivated admins without touching data", async () => {
    await expect(saveSettingsAction(valid)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    state.session = { user: { id: driverId } };
    await expect(saveSettingsAction(valid)).rejects.toMatchObject({ code: "FORBIDDEN" });
    state.session = { user: { id: inactiveAdminId } };
    await expect(saveSettingsAction(valid)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(await t.prisma.settings.count()).toBe(0);
    expect(updateTag).not.toHaveBeenCalled();
  });

  it("reads null before the first save and treats the depot as not set", async () => {
    expect(await readSettings(t.prisma)).toBeNull();
    expect(getDepot(await readSettings(t.prisma))).toBeNull();
  });

  it("saves normalized settings for an admin and expires the cache tag", async () => {
    state.session = { user: { id: adminId } };
    expect(await saveSettingsAction(valid)).toEqual({ ok: true });
    expect(updateTag).toHaveBeenCalledWith("settings");
    const stored = await readSettings(t.prisma);
    expect(stored).toMatchObject({
      depotName: "Nudelfabrik",
      depotLat: 48.208212,
      depotLng: 16.3738,
      depotPinConfirmed: true,
      departureTime: "06:30",
      serviceMinutesPerStop: 12,
      deliveryWeekdays: [1, 2, 5],
    });
    expect(getDepot(stored)).toMatchObject({ lat: 48.208212, lng: 16.3738 });
    // Second save updates the singleton instead of adding a row.
    expect(await saveSettingsAction({ ...valid, deliveryWeekdays: [3] })).toEqual({ ok: true });
    expect(await t.prisma.settings.count()).toBe(1);
    expect((await readSettings(t.prisma))?.deliveryWeekdays).toEqual([3]);
  });

  it.each([
    ["unconfirmed pin", { depotPinConfirmed: false }],
    ["no weekday", { deliveryWeekdays: [] }],
    ["weekday 8", { deliveryWeekdays: [8] }],
    ["bad time", { departureTime: "25:00" }],
    ["bad time format", { departureTime: "7:00" }],
    ["unknown time zone", { timezone: "Mars/Olympus" }],
    ["latitude out of range", { depotLat: 91 }],
    ["NaN longitude", { depotLng: Number.NaN }],
    ["negative service minutes", { serviceMinutesPerStop: -1 }],
    ["fractional service minutes", { serviceMinutesPerStop: 1.5 }],
    ["too many service minutes", { serviceMinutesPerStop: 181 }],
    ["blank name", { depotName: "   " }],
  ])("rejects invalid input (%s) and keeps the old values", async (_label, patch) => {
    state.session = { user: { id: adminId } };
    const before = await readSettings(t.prisma);
    expect(await saveSettingsAction({ ...valid, ...patch })).toEqual({
      ok: false,
      error: "invalid",
    });
    expect(await readSettings(t.prisma)).toEqual(before);
    expect(updateTag).not.toHaveBeenCalled();
  });

  it("rejects non-object input", async () => {
    state.session = { user: { id: adminId } };
    expect(await saveSettingsAction(null)).toEqual({ ok: false, error: "invalid" });
    expect(await saveSettingsAction("x")).toEqual({ ok: false, error: "invalid" });
  });
});
