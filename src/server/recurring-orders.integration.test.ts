// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { hashSecret } from "./auth/password";
import { setCustomerActive } from "./customer-admin";
import { handleRecurringCron } from "./recurring-cron";
import {
  createRecurringOrder,
  generateRecurringOrders,
  listRecurringOrders,
  setRecurringOrderActive,
  updateRecurringOrder,
} from "./recurring-orders";
import { createTestDb, type TestDb } from "./test-db";
import { createTourService } from "./tour-service";

vi.mock("next/cache", () => ({ updateTag: vi.fn(), cacheTag: vi.fn(), cacheLife: vi.fn() }));

// Monday 2099-06-15 is "today" in these tests; the default lead time is 14 days (to 2099-06-29).
const TODAY = new Date("2099-06-15T00:00:00Z");
const day = (v: string) => new Date(`${v}T00:00:00Z`);
const iso = (d: Date | null) => d?.toISOString().slice(0, 10);

describe.skipIf(!process.env.DATABASE_URL)(
  "recurring orders (NUD-149)",
  { timeout: 60_000 },
  () => {
    let t: TestDb;
    let adminId: string;
    let pack: string;
    let crate: string;
    let n = 0;
    const tours = () => createTourService(t.prisma);
    const ctx = () => ({ today: TODAY, tours: tours() });

    async function customer(active = true) {
      n += 1;
      return t.prisma.customer
        .create({
          data: {
            customerNumber: `R${n}`,
            name: `Kunde ${n}`,
            street: "Hauptstraße 1",
            postalCode: "1010",
            city: "Wien",
            active,
          },
        })
        .then((c) => c.id);
    }

    const rule = (customerId: string, over: Record<string, unknown> = {}) => ({
      customerId,
      weekdays: [1, 4],
      anchorDate: "2099-06-15",
      lines: [
        { productId: pack, quantity: 2 },
        { productId: crate, quantity: 1 },
      ],
      ...over,
    });

    const ordersOf = (customerId: string) =>
      t.prisma.order.findMany({
        where: { customerId },
        orderBy: { deliveryDate: "asc" },
        include: { items: true },
      });

    beforeAll(async () => {
      t = await createTestDb();
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
      const product = (sku: string, unit: "PACK" | "CRATE", sortOrder: number) =>
        t.prisma.product
          .create({
            data: {
              sku,
              unit,
              weightKgPerUnit: 3,
              sortOrder,
              name: { de: sku, meta: { source: "de", machine: {} } },
            },
          })
          .then((p) => p.id);
      pack = await product("BEUTEL", "PACK", 1);
      crate = await product("KARTON", "CRATE", 2);
    });

    afterAll(async () => {
      await t.teardown();
    });

    it("confirming a rule generates linked CONFIRMED orders up to the lead time and audits them", async () => {
      const c = await customer();
      const result = await createRecurringOrder(t.prisma, adminId, rule(c), ctx());
      expect(result).toMatchObject({ ok: true, generated: 5 });
      const orders = await ordersOf(c);
      // Mon/Thu from 2099-06-15 to 2099-06-29.
      expect(orders.map((o) => iso(o.deliveryDate))).toEqual([
        "2099-06-15",
        "2099-06-18",
        "2099-06-22",
        "2099-06-25",
        "2099-06-29",
      ]);
      for (const o of orders) {
        expect(o).toMatchObject({
          status: "CONFIRMED",
          source: "MANUAL",
          createdById: adminId,
          recurringOrderId: result.ok ? result.id : "",
        });
        expect(iso(o.recurringDate)).toBe(iso(o.deliveryDate));
        expect(iso(o.windowFrom)).toBe(iso(o.deliveryDate));
        expect(iso(o.windowTo)).toBe(iso(o.deliveryDate));
        expect(o.items.map((i) => [i.productId, i.quantity]).sort()).toEqual(
          [
            [crate, 1],
            [pack, 2],
          ].sort(),
        );
      }
      const audit = await t.prisma.auditLog.findMany({
        where: { OR: [{ entity: "RecurringOrder" }, { entity: "Order", action: "order.create" }] },
      });
      expect(audit.some((a) => a.action === "recurring.create")).toBe(true);
      expect(
        audit.filter((a) => a.entity === "Order" && orders.some((o) => o.id === a.entityId)),
      ).toHaveLength(5);
    });

    it("a second run (cron twice) creates no duplicates", async () => {
      const c = await customer();
      await createRecurringOrder(t.prisma, adminId, rule(c), ctx());
      const before = await t.prisma.order.count({ where: { customerId: c } });
      const first = await generateRecurringOrders(t.prisma, ctx());
      const second = await generateRecurringOrders(t.prisma, ctx());
      expect(first.created).toBe(0);
      expect(second.created).toBe(0);
      expect(await t.prisma.order.count({ where: { customerId: c } })).toBe(before);

      // Through the cron route, run twice and concurrently.
      const run = () => generateRecurringOrders(t.prisma, ctx());
      const request = () =>
        new Request("http://localhost/api/cron/recurring-orders", {
          headers: { authorization: "Bearer s3cret" },
        });
      const responses = await Promise.all([
        handleRecurringCron(request(), { secret: "s3cret", run }),
        handleRecurringCron(request(), { secret: "s3cret", run }),
      ]);
      expect(responses.map((r) => r.status)).toEqual([200, 200]);
      expect(await t.prisma.order.count({ where: { customerId: c } })).toBe(before);
      const unauth = await handleRecurringCron(request(), { secret: "other", run });
      expect(unauth.status).toBe(401);
    });

    it("concurrent generation of the same day hits the unique key, not a duplicate", async () => {
      const c = await customer();
      const created = await createRecurringOrder(t.prisma, adminId, rule(c), ctx());
      if (!created.ok) throw new Error("setup");
      // Remove the generated rows so both runs race for the same days (test cleanup only).
      await t.prisma.order.deleteMany({ where: { customerId: c } });
      const reports = await Promise.all([
        generateRecurringOrders(t.prisma, { ...ctx(), ruleIds: [created.id] }),
        generateRecurringOrders(t.prisma, { ...ctx(), ruleIds: [created.id] }),
      ]);
      expect(reports.reduce((s, r) => s + r.created, 0)).toBe(5);
      expect(await t.prisma.order.count({ where: { customerId: c } })).toBe(5);
    });

    it("a cancelled generated order is not generated again", async () => {
      const c = await customer();
      await createRecurringOrder(t.prisma, adminId, rule(c, { weekdays: [1] }), ctx());
      const [first] = await ordersOf(c);
      await t.prisma.order.update({ where: { id: first!.id }, data: { status: "CANCELLED" } });
      const report = await generateRecurringOrders(t.prisma, ctx());
      expect(report.created).toBe(0);
      expect((await ordersOf(c)).filter((o) => o.status === "CANCELLED")).toHaveLength(1);
    });

    it("every second week, season and exceptions shape the generated days", async () => {
      const c = await customer();
      await createRecurringOrder(
        t.prisma,
        adminId,
        rule(c, {
          weekdays: [1],
          everyNWeeks: 2,
          exceptions: ["2099-06-29"],
          seasonFrom: "09-01",
          seasonTo: "06-28", // ends before the last Monday
        }),
        ctx(),
      );
      expect((await ordersOf(c)).map((o) => iso(o.deliveryDate))).toEqual(["2099-06-15"]);
    });

    it("pausing stops generation, resuming continues; the lead time is a setting", async () => {
      const c = await customer();
      const created = await createRecurringOrder(
        t.prisma,
        adminId,
        rule(c, { weekdays: [1], anchorDate: "2099-06-15" }),
        ctx(),
      );
      if (!created.ok) throw new Error("setup");
      expect(await ordersOf(c)).toHaveLength(3); // 15th, 22nd, 29th
      await setRecurringOrderActive(t.prisma, adminId, created.id, false, ctx());
      await t.prisma.settings.upsert({
        where: { id: 1 },
        create: {
          id: 1,
          depotName: "D",
          depotAddress: "A",
          depotLat: 48,
          depotLng: 16,
          recurringLeadDays: 28,
        },
        update: { recurringLeadDays: 28 },
      });
      expect(
        (await generateRecurringOrders(t.prisma, { ...ctx(), ruleIds: [created.id] })).created,
      ).toBe(0);
      expect(await ordersOf(c)).toHaveLength(3);
      const resumed = await setRecurringOrderActive(t.prisma, adminId, created.id, true, ctx());
      expect(resumed).toEqual({ ok: true, generated: 2 }); // 6th and 13th of July
      expect((await ordersOf(c)).map((o) => iso(o.deliveryDate))).toEqual([
        "2099-06-15",
        "2099-06-22",
        "2099-06-29",
        "2099-07-06",
        "2099-07-13",
      ]);
      await t.prisma.settings.update({ where: { id: 1 }, data: { recurringLeadDays: 14 } });
    });

    it("editing a rule keeps generated orders and applies to days without one", async () => {
      const c = await customer();
      const created = await createRecurringOrder(
        t.prisma,
        adminId,
        rule(c, { weekdays: [1] }),
        ctx(),
      );
      if (!created.ok) throw new Error("setup");
      const result = await updateRecurringOrder(
        t.prisma,
        adminId,
        created.id,
        rule(c, { weekdays: [1, 2], lines: [{ productId: pack, quantity: 9 }] }),
        ctx(),
      );
      expect(result).toMatchObject({ ok: true, generated: 2 }); // the Tuesdays 16th and 23rd
      const orders = await ordersOf(c);
      expect(orders).toHaveLength(5);
      expect(orders[0]!.items.map((i) => i.quantity).sort()).toEqual([1, 2]); // old Monday order
      expect(orders[1]!.items.map((i) => i.quantity)).toEqual([9]);
      const [view] = await listRecurringOrders(t.prisma, c, TODAY);
      expect(view).toMatchObject({ weekdays: [1, 2], state: "active" });
      expect(view!.lines).toHaveLength(1);
      expect(view!.nextDates[0]).toBe("2099-06-15");
      expect(
        await t.prisma.auditLog.count({
          where: { entityId: created.id, action: "recurring.update" },
        }),
      ).toBe(1);
    });

    it("rejects unknown or inactive customers and products, and bad input", async () => {
      const c = await customer();
      const inactive = await customer(false);
      expect(await createRecurringOrder(t.prisma, adminId, rule(c, { lines: [] }), ctx())).toEqual({
        ok: false,
        error: "invalid",
      });
      expect(
        await createRecurringOrder(
          t.prisma,
          adminId,
          rule(c, { lines: [{ productId: pack, quantity: 1.5 }] }),
          ctx(),
        ),
      ).toEqual({ ok: false, error: "invalid" });
      expect(await createRecurringOrder(t.prisma, adminId, rule("nope"), ctx())).toEqual({
        ok: false,
        error: "customer_not_found",
      });
      expect(await createRecurringOrder(t.prisma, adminId, rule(inactive), ctx())).toEqual({
        ok: false,
        error: "customer_inactive",
      });
      expect(
        await createRecurringOrder(
          t.prisma,
          adminId,
          rule(c, { lines: [{ productId: "nope", quantity: 1 }] }),
          ctx(),
        ),
      ).toEqual({ ok: false, error: "product_not_found" });
      expect(await ordersOf(c)).toHaveLength(0);
    });

    it("deactivating a customer cancels his future open orders and pauses his rules; reactivating resumes the rules", async () => {
      const c = await customer();
      const other = await customer();
      const created = await createRecurringOrder(
        t.prisma,
        adminId,
        rule(c, { weekdays: [1] }),
        ctx(),
      );
      if (!created.ok) throw new Error("setup");
      await createRecurringOrder(t.prisma, adminId, rule(other, { weekdays: [1] }), ctx());
      const manual = (date: string, status: "DRAFT" | "CONFIRMED") =>
        t.prisma.order.create({
          data: {
            customerId: c,
            deliveryDate: day(date),
            windowFrom: day(date),
            windowTo: day(date),
            status,
            createdById: adminId,
            items: { create: [{ productId: pack, quantity: 4 }] },
          },
        });
      const draft = await manual("2099-06-17", "DRAFT");
      const past = await manual("2099-06-10", "CONFIRMED");
      // The order of today is already delivered: the driver completed its stop.
      const [today, second] = await ordersOf(c).then((o) => o.filter((x) => x.recurringOrderId));
      const tour = await t.prisma.tour.create({
        data: {
          date: TODAY,
          status: "IN_PROGRESS",
          depotSnapshot: {},
          stops: { create: [{ customerId: c, sequence: 1, status: "DELIVERED" }] },
        },
        include: { stops: true },
      });
      await t.prisma.stopOrder.create({ data: { stopId: tour.stops[0]!.id, orderId: today!.id } });
      // The 22nd has a released and a completed tour; only the released one is flagged.
      const released = await t.prisma.tour.create({
        data: { date: second!.deliveryDate, status: "RELEASED", depotSnapshot: {} },
      });
      const completed = await t.prisma.tour.create({
        data: { date: second!.deliveryDate, status: "COMPLETED", depotSnapshot: {} },
      });

      const result = await setCustomerActive(t.prisma, c, false, {
        actorId: adminId,
        today: TODAY,
        tours: tours(),
      });
      // The 22nd and 29th (generated) and the draft of the 17th are cancelled.
      expect(result).toEqual({ ok: true, cancelledOrders: 3, pausedRules: 1, resumedRules: 0 });
      const status = async (id: string) =>
        (await t.prisma.order.findUniqueOrThrow({ where: { id } })).status;
      expect(await status(draft.id)).toBe("CANCELLED");
      expect(await status(past.id)).toBe("CONFIRMED");
      expect(await status(today!.id)).toBe("CONFIRMED");
      expect((await ordersOf(c)).filter((o) => o.recurringOrderId).map((o) => o.status)).toEqual([
        "CONFIRMED",
        "CANCELLED",
        "CANCELLED",
      ]);
      // Nothing was deleted, the other customer is untouched.
      expect(await ordersOf(c)).toHaveLength(5);
      expect((await ordersOf(other)).every((o) => o.status === "CONFIRMED")).toBe(true);
      expect(
        (await t.prisma.tour.findUniqueOrThrow({ where: { id: released.id } })).isOutdated,
      ).toBe(true);
      expect(
        (await t.prisma.tour.findUniqueOrThrow({ where: { id: completed.id } })).isOutdated,
      ).toBe(false);
      const stored = await t.prisma.recurringOrder.findUniqueOrThrow({ where: { id: created.id } });
      expect(stored).toMatchObject({ active: false, pausedByCustomer: true });
      const audit = await t.prisma.auditLog.findMany({
        where: { OR: [{ entity: "Customer", entityId: c }, { action: "order.cancel" }] },
      });
      expect(audit.filter((a) => a.action === "order.cancel")).toHaveLength(3);
      expect(audit.find((a) => a.action === "customer.deactivate")?.diff).toMatchObject({
        cancelledOrders: 3,
        pausedRules: 1,
      });
      // While the customer is inactive nothing is generated and the rule cannot be resumed.
      expect((await generateRecurringOrders(t.prisma, ctx())).created).toBe(0);
      expect(await setRecurringOrderActive(t.prisma, adminId, created.id, true, ctx())).toEqual({
        ok: false,
        error: "customer_inactive",
      });

      // Reactivation resumes the rule; cancelled orders stay cancelled (one order per rule and day).
      expect(
        await setCustomerActive(t.prisma, c, true, {
          actorId: adminId,
          today: TODAY,
          tours: tours(),
        }),
      ).toEqual({ ok: true, cancelledOrders: 0, pausedRules: 0, resumedRules: 1 });
      expect(
        await t.prisma.recurringOrder.findUniqueOrThrow({ where: { id: created.id } }),
      ).toMatchObject({ active: true, pausedByCustomer: false });
      expect((await ordersOf(c)).filter((o) => o.recurringOrderId).map((o) => o.status)).toEqual([
        "CONFIRMED",
        "CANCELLED",
        "CANCELLED",
      ]);
    });

    it("a rule the office paused stays paused when the customer comes back", async () => {
      const c = await customer();
      const created = await createRecurringOrder(
        t.prisma,
        adminId,
        rule(c, { weekdays: [1] }),
        ctx(),
      );
      if (!created.ok) throw new Error("setup");
      await setRecurringOrderActive(t.prisma, adminId, created.id, false, ctx());
      const base = { actorId: adminId, today: TODAY, tours: tours() };
      expect(await setCustomerActive(t.prisma, c, false, base)).toMatchObject({ pausedRules: 0 });
      expect(await setCustomerActive(t.prisma, c, true, base)).toMatchObject({ resumedRules: 0 });
      expect(
        (await t.prisma.recurringOrder.findUniqueOrThrow({ where: { id: created.id } })).active,
      ).toBe(false);
    });
  },
);
