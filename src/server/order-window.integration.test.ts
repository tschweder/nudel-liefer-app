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

const { createOrderAction, updateOrderAction } = await import("./order-actions");
const { setStorageForTests } = await import("./storage");
const { FakeStorage } = await import("./storage/fake");

// Monday 2099-06-15 .. : TUE/WED/THU are the 16th/17th/18th (checked below).
const MON = "2099-06-15";
const TUE = "2099-06-16";
const WED = "2099-06-17";
const THU = "2099-06-18";
const SAT = "2099-06-20";
const date = (d: string) => new Date(`${d}T00:00:00Z`);

describe.skipIf(!process.env.DATABASE_URL)(
  "order delivery window (NUD-148)",
  { timeout: 60_000 },
  () => {
    let t: TestDb;
    let adminId: string;
    let customerId: string;
    let productId: string;

    beforeAll(async () => {
      t = await createTestDb();
      state.db = t.prisma;
      adminId = await t.prisma.user
        .create({
          data: {
            role: "ADMIN",
            email: "a@example.com",
            passwordHash: await hashSecret("123456"),
            displayName: "A",
          },
        })
        .then((u) => u.id);
      customerId = await t.prisma.customer
        .create({
          data: {
            customerNumber: "C1",
            name: "Kunde 1",
            street: "Hauptstraße 1",
            postalCode: "1010",
            city: "Wien",
          },
        })
        .then((c) => c.id);
      productId = await t.prisma.product
        .create({
          data: {
            sku: "P1",
            unit: "PACK",
            weightKgPerUnit: 1,
            sortOrder: 1,
            name: { de: "P1", meta: { source: "de", machine: {} } },
          },
        })
        .then((p) => p.id);
      await t.prisma.vehicle.create({ data: { name: "V1", capacityKg: 500 } });
    }, 60_000);

    afterAll(async () => {
      await t?.teardown();
    });

    beforeEach(async () => {
      state.session = { user: { id: adminId } };
      setStorageForTests(new FakeStorage());
      await t.prisma.orderItem.deleteMany();
      await t.prisma.order.deleteMany();
    });

    const create = (extra: Record<string, unknown>, quantity = "10") =>
      createOrderAction({
        customerId,
        lines: [{ productId, quantity }],
        ...extra,
      });
    const load = (id: string) => t.prisma.order.findUniqueOrThrow({ where: { id } });

    it("uses Tuesday..Thursday in 2099-06 as the test days", () => {
      expect(date(TUE).getUTCDay()).toBe(2);
      expect(date(THU).getUTCDay()).toBe(4);
      expect(date(SAT).getUTCDay()).toBe(6);
    });

    it("window Tue-Thu, Tue full -> planned Wed", async () => {
      // 450 kg already planned on Tuesday of 500 kg capacity.
      expect((await create({ deliveryDate: TUE }, "450")).ok).toBe(true);
      const result = await create({ windowFrom: TUE, windowTo: THU }, "100");
      expect(result).toMatchObject({ ok: true, plannedDate: WED, warnings: [] });
      if (!result.ok) return;
      expect(await load(result.id)).toMatchObject({
        deliveryDate: date(WED),
        windowFrom: date(TUE),
        windowTo: date(THU),
      });
    });

    it("window Tue-Thu, Tue free -> planned Tue", async () => {
      const result = await create({ windowFrom: TUE, windowTo: THU });
      expect(result).toMatchObject({ ok: true, plannedDate: TUE });
    });

    it("only a planned day is the whole-day window", async () => {
      const result = await create({ deliveryDate: WED });
      if (!result.ok) throw new Error(result.error);
      expect(await load(result.id)).toMatchObject({
        deliveryDate: date(WED),
        windowFrom: date(WED),
        windowTo: date(WED),
        windowFromTime: null,
        windowToTime: null,
      });
    });

    it("stores the time of day; the office may move the day outside the window with a warning", async () => {
      const result = await create({
        windowFrom: TUE,
        windowTo: TUE,
        windowFromTime: "08:00",
        windowToTime: "11:00",
        deliveryDate: THU,
      });
      expect(result).toMatchObject({ ok: true, plannedDate: THU, warnings: ["outside_window"] });
      if (!result.ok) return;
      expect(await load(result.id)).toMatchObject({
        windowFromTime: "08:00",
        windowToTime: "11:00",
      });
    });

    it("every day full: earliest delivery weekday plus a capacity warning", async () => {
      for (const d of [TUE, WED]) expect((await create({ deliveryDate: d }, "500")).ok).toBe(true);
      const result = await create({ windowFrom: TUE, windowTo: WED });
      expect(result).toMatchObject({ ok: true, plannedDate: TUE, warnings: ["no_capacity"] });
    });

    it("window without a delivery weekday warns", async () => {
      const result = await create({ windowFrom: SAT, windowTo: SAT });
      expect(result).toMatchObject({ ok: true, plannedDate: SAT, warnings: ["no_delivery_day"] });
    });

    it("rejects invalid windows and windows in the past", async () => {
      expect(await create({ windowFrom: THU, windowTo: TUE })).toEqual({
        ok: false,
        error: "invalid",
      });
      expect(
        await create({
          windowFrom: TUE,
          windowTo: TUE,
          windowFromTime: "11:00",
          windowToTime: "08:00",
        }),
      ).toEqual({
        ok: false,
        error: "invalid",
      });
      expect(await create({ windowFrom: TUE, windowTo: TUE, windowFromTime: "25:00" })).toEqual({
        ok: false,
        error: "invalid",
      });
      expect(await create({ windowFrom: "2020-01-01", windowTo: "2020-01-02" })).toEqual({
        ok: false,
        error: "date_in_past",
      });
      expect(await create({})).toEqual({ ok: false, error: "invalid" });
    });

    it("editing re-plans without counting the order itself and writes the window to the audit log", async () => {
      const created = await create({ windowFrom: TUE, windowTo: THU }, "450");
      if (!created.ok) throw new Error(created.error);
      const updated = await updateOrderAction(created.id, {
        status: "CONFIRMED",
        windowFrom: TUE,
        windowTo: WED,
        windowFromTime: "09:00",
        lines: [{ productId, quantity: "460" }],
      });
      expect(updated).toMatchObject({ ok: true, plannedDate: TUE });
      const audit = await t.prisma.auditLog.findMany({
        where: { entityId: created.id, action: "order.update" },
      });
      expect(JSON.stringify(audit[0]?.diff)).toContain("2099-06-16..2099-06-17 09:00-");
      expect(MON).toBeTruthy();
    });
  },
);
