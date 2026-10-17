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

const { confirmedOrderCountAction, createOrderAction } = await import("./order-actions");
const { orderableCustomersQuery, orderOverviewQuery } = await import("./order-queries");
const { activeProductsQuery } = await import("./product-queries");

const FUTURE = "2099-06-15";
const FUTURE_DATE = new Date("2099-06-15T00:00:00Z");

describe.skipIf(!process.env.DATABASE_URL)("manual order entry", { timeout: 60_000 }, () => {
  let t: TestDb;
  let adminId: string;
  let driverId: string;
  let inactiveAdminId: string;
  let customerId: string;
  let archivedId: string;
  let unconfirmedId: string;
  let p1: string;
  let p2: string;
  let p3: string;
  let inactiveProduct: string;

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
    const customer = (n: string, extra: Record<string, unknown> = {}) =>
      t.prisma.customer
        .create({
          data: {
            customerNumber: n,
            name: `Kunde ${n}`,
            street: "Hauptstraße 1",
            postalCode: "1010",
            city: "Wien",
            pinConfirmed: true,
            ...extra,
          },
        })
        .then((c) => c.id);
    customerId = await customer("C1");
    archivedId = await customer("C2", { active: false });
    unconfirmedId = await customer("C3", { pinConfirmed: false });
    const product = (sku: string, extra: Record<string, unknown> = {}) =>
      t.prisma.product
        .create({
          data: {
            sku,
            unit: "PACK",
            name: { de: sku, meta: { source: "de", machine: {} } },
            ...extra,
          },
        })
        .then((p) => p.id);
    p1 = await product("P1", { sortOrder: 1 });
    p2 = await product("P2", { sortOrder: 2 });
    p3 = await product("P3", { sortOrder: 3 });
    inactiveProduct = await product("P4", { active: false, sortOrder: 4 });
  }, 60_000);

  afterAll(async () => {
    await t?.teardown();
  });

  beforeEach(async () => {
    state.session = null;
    await t.prisma.orderItem.deleteMany();
    await t.prisma.order.deleteMany();
  });

  const asAdmin = () => {
    state.session = { user: { id: adminId } };
  };
  const input = (extra: Record<string, unknown> = {}) => ({
    customerId,
    deliveryDate: FUTURE,
    lines: [{ productId: p1, quantity: "2,5" }],
    ...extra,
  });

  it("rejects anonymous callers, drivers and deactivated admins on every action and read", async () => {
    const calls: Array<() => Promise<unknown>> = [
      () => createOrderAction(input()),
      () => confirmedOrderCountAction(customerId, FUTURE),
      () => orderableCustomersQuery(),
      () => orderOverviewQuery(),
    ];
    const sessions: Array<[typeof state.session, string]> = [
      [null, "UNAUTHENTICATED"],
      [{ user: { id: driverId } }, "FORBIDDEN"],
      [{ user: { id: inactiveAdminId } }, "UNAUTHENTICATED"],
    ];
    for (const [session, code] of sessions) {
      for (const call of calls) {
        state.session = session;
        await expect(call()).rejects.toMatchObject({ code });
      }
    }
    expect(await t.prisma.order.count()).toBe(0);
  });

  it("saves an order with three lines (comma and dot decimals) as CONFIRMED / MANUAL", async () => {
    asAdmin();
    const result = await createOrderAction(
      input({
        internalNote: "  per Telefon  ",
        lines: [
          { productId: p1, quantity: "2,5" },
          { productId: p2, quantity: "10" },
          { productId: p3, quantity: "0.25" },
        ],
      }),
    );
    expect(result).toMatchObject({ ok: true, status: "CONFIRMED" });
    const order = await t.prisma.order.findFirstOrThrow({
      include: { items: { orderBy: { quantity: "desc" } } },
    });
    expect(order).toMatchObject({
      customerId,
      status: "CONFIRMED",
      source: "MANUAL",
      internalNote: "per Telefon",
      createdById: adminId,
      screenshotId: null,
    });
    expect(order.deliveryDate.toISOString()).toBe(FUTURE_DATE.toISOString());
    expect(order.items.map((i) => [i.productId, i.quantity.toString()])).toEqual([
      [p2, "10"],
      [p1, "2.5"],
      [p3, "0.25"],
    ]);
  });

  it("saves as DRAFT when asked", async () => {
    asAdmin();
    expect(await createOrderAction(input({ status: "DRAFT" }))).toMatchObject({
      ok: true,
      status: "DRAFT",
    });
    expect((await t.prisma.order.findFirstOrThrow()).status).toBe("DRAFT");
  });

  it("merges the same product entered twice into one item (decision: merge, not reject)", async () => {
    asAdmin();
    const result = await createOrderAction(
      input({
        lines: [
          { productId: p1, quantity: "2,5" },
          { productId: p2, quantity: "1" },
          { productId: p1, quantity: "0.5" },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    const items = await t.prisma.orderItem.findMany({ orderBy: { productId: "asc" } });
    expect(items).toHaveLength(2);
    expect(items.find((i) => i.productId === p1)?.quantity.toString()).toBe("3");
    expect(items.find((i) => i.productId === p2)?.quantity.toString()).toBe("1");
  });

  it("rejects invalid input and writes nothing", async () => {
    asAdmin();
    const bad: Array<Record<string, unknown>> = [
      { lines: [] },
      { lines: [{ productId: p1, quantity: "0" }] },
      { lines: [{ productId: p1, quantity: "-3" }] },
      { lines: [{ productId: p1, quantity: "abc" }] },
      { lines: [{ productId: p1, quantity: "1,555" }] },
      {
        lines: [
          { productId: p1, quantity: "1" },
          { productId: p2, quantity: "0" },
        ],
      },
      {
        lines: [
          { productId: p1, quantity: "99999999.99" },
          { productId: p1, quantity: "1" },
        ],
      },
      { lines: "nonsense" },
      { customerId: "" },
      { deliveryDate: "2099-02-30" },
      { deliveryDate: "15.06.2099" },
      { status: "CANCELLED" },
    ];
    for (const override of bad) {
      expect(await createOrderAction(input(override))).toEqual({ ok: false, error: "invalid" });
    }
    expect(await createOrderAction("nonsense")).toEqual({ ok: false, error: "invalid" });
    expect(await createOrderAction(null)).toEqual({ ok: false, error: "invalid" });
    expect(await t.prisma.order.count()).toBe(0);
  });

  it("rejects dates in the past, archived or unknown customers and inactive or unknown products", async () => {
    asAdmin();
    expect(await createOrderAction(input({ deliveryDate: "2020-01-01" }))).toEqual({
      ok: false,
      error: "date_in_past",
    });
    expect(await createOrderAction(input({ customerId: archivedId }))).toEqual({
      ok: false,
      error: "customer_inactive",
    });
    expect(await createOrderAction(input({ customerId: "does-not-exist" }))).toEqual({
      ok: false,
      error: "customer_not_found",
    });
    expect(
      await createOrderAction(input({ lines: [{ productId: inactiveProduct, quantity: "1" }] })),
    ).toEqual({ ok: false, error: "product_inactive" });
    expect(
      await createOrderAction(input({ lines: [{ productId: "nope", quantity: "1" }] })),
    ).toEqual({ ok: false, error: "product_not_found" });
    expect(await t.prisma.order.count()).toBe(0);
  });

  it("an unconfirmed pin does not block saving (it is only a warning in the form)", async () => {
    asAdmin();
    expect(await createOrderAction(input({ customerId: unconfirmedId }))).toMatchObject({
      ok: true,
    });
  });

  it("offers only active customers and only active products", async () => {
    asAdmin();
    const customers = await orderableCustomersQuery();
    const numbers = customers.map((c) => c.customerNumber);
    expect(numbers).toContain("C1");
    expect(numbers).toContain("C3");
    expect(numbers).not.toContain("C2"); // archived
    expect(customers.find((c) => c.customerNumber === "C3")?.pinConfirmed).toBe(false);
    const skus = (await activeProductsQuery()).map((p) => p.sku);
    expect(skus).toEqual(["P1", "P2", "P3"]);
  });

  it("counts only CONFIRMED orders of that customer and day", async () => {
    asAdmin();
    expect(await confirmedOrderCountAction(customerId, FUTURE)).toBe(0);
    await createOrderAction(input());
    await createOrderAction(input({ status: "DRAFT" }));
    await createOrderAction(input({ deliveryDate: "2099-06-16" }));
    await createOrderAction(input({ customerId: unconfirmedId }));
    expect(await confirmedOrderCountAction(customerId, FUTURE)).toBe(1);
    await createOrderAction(input());
    expect(await confirmedOrderCountAction(customerId, FUTURE)).toBe(2);
    await t.prisma.order.updateMany({ data: { status: "CANCELLED" } });
    expect(await confirmedOrderCountAction(customerId, FUTURE)).toBe(0);
    expect(await confirmedOrderCountAction("", "garbage")).toBe(0);
  });

  it("lists upcoming orders with items for the minimal overview, not past ones", async () => {
    asAdmin();
    await createOrderAction(input({ lines: [{ productId: p1, quantity: "4" }] }));
    // A past order can only exist from before (e.g. imported); insert directly.
    await t.prisma.order.create({
      data: {
        customerId,
        deliveryDate: new Date("2020-01-01T00:00:00Z"),
        status: "CONFIRMED",
        createdById: adminId,
      },
    });
    const rows = await orderOverviewQuery();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "CONFIRMED",
      source: "MANUAL",
      customer: { customerNumber: "C1" },
    });
    expect(rows[0]?.items).toHaveLength(1);
    expect(rows[0]?.items[0]?.quantity).toBe("4");
  });
});
