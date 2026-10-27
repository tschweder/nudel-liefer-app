// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hashSecret } from "./auth/password";
import { CATALOG_SKUS } from "./product-catalog";
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

const {
  cancelOrderAction,
  confirmedOrderCountAction,
  createOrderAction,
  dayTourCompletedAction,
  duplicateOrderAction,
  screenshotPreviewUrlAction,
  updateOrderAction,
} = await import("./order-actions");
const { orderableCustomersQuery, orderDetailQuery, orderOverviewQuery } =
  await import("./order-queries");
const { setStorageForTests } = await import("./storage");
const { FakeStorage } = await import("./storage/fake");
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
            weightKgPerUnit: 1,
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

  let storage: InstanceType<typeof FakeStorage>;
  let seq = 0;
  /** Simulates a finished browser upload; returns the key `POST /api/uploads` would have issued. */
  const uploadedScreenshot = (bytes = 2048) => {
    const key = `screenshots/${(++seq).toString(16).padStart(8, "0")}-0000-4000-8000-000000000000.jpg`;
    storage.put(key, new Uint8Array(bytes), "image/jpeg");
    return key;
  };

  beforeEach(async () => {
    state.session = null;
    storage = new FakeStorage();
    setStorageForTests(storage);
    await t.prisma.orderItem.deleteMany();
    await t.prisma.order.deleteMany();
    await t.prisma.screenshot.deleteMany();
  });

  const asAdmin = () => {
    state.session = { user: { id: adminId } };
  };
  const input = (extra: Record<string, unknown> = {}) => ({
    customerId,
    deliveryDate: FUTURE,
    lines: [{ productId: p1, quantity: "3" }],
    ...extra,
  });

  it("rejects anonymous callers, drivers and deactivated admins on every action and read", async () => {
    const calls: Array<() => Promise<unknown>> = [
      () => createOrderAction(input()),
      () => confirmedOrderCountAction(customerId, FUTURE),
      () => orderableCustomersQuery(),
      () => orderOverviewQuery(),
      () => orderDetailQuery("whatever"),
      () => updateOrderAction("whatever", input()),
      () => cancelOrderAction("whatever"),
      () => duplicateOrderAction("whatever", FUTURE),
      () => screenshotPreviewUrlAction(uploadedScreenshot()),
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

  it("saves an order with three lines (digit strings and numbers) as CONFIRMED / MANUAL", async () => {
    asAdmin();
    const result = await createOrderAction(
      input({
        internalNote: "  per Telefon  ",
        lines: [
          { productId: p1, quantity: "3" },
          { productId: p2, quantity: 10 },
          { productId: p3, quantity: "1" },
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
    expect(order.items.map((i) => [i.productId, i.quantity])).toEqual([
      [p2, 10],
      [p1, 3],
      [p3, 1],
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
          { productId: p1, quantity: "2" },
          { productId: p2, quantity: 1 },
          { productId: p1, quantity: "1" },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    const items = await t.prisma.orderItem.findMany({ orderBy: { productId: "asc" } });
    expect(items).toHaveLength(2);
    expect(items.find((i) => i.productId === p1)?.quantity).toBe(3);
    expect(items.find((i) => i.productId === p2)?.quantity).toBe(1);
  });

  it("rejects invalid input and writes nothing", async () => {
    asAdmin();
    const bad: Array<Record<string, unknown>> = [
      { lines: [] },
      { lines: [{ productId: p1, quantity: 0 }] },
      { lines: [{ productId: p1, quantity: "-3" }] },
      { lines: [{ productId: p1, quantity: "abc" }] },
      { lines: [{ productId: p1, quantity: "2,5" }] },
      { lines: [{ productId: p1, quantity: "2.5" }] },
      { lines: [{ productId: p1, quantity: 2.5 }] },
      {
        lines: [
          { productId: p1, quantity: 1 },
          { productId: p2, quantity: 0 },
        ],
      },
      {
        lines: [
          { productId: p1, quantity: 99_999 },
          { productId: p1, quantity: 1 },
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
      await createOrderAction(input({ lines: [{ productId: inactiveProduct, quantity: 1 }] })),
    ).toEqual({ ok: false, error: "product_inactive" });
    expect(await createOrderAction(input({ lines: [{ productId: "nope", quantity: 1 }] }))).toEqual(
      { ok: false, error: "product_not_found" },
    );
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
    const skus = (await activeProductsQuery()).map((p) => p.sku);
    // The three catalog products (NUD-138) come from the migration; the test adds P1-P3.
    expect(skus.filter((s) => !CATALOG_SKUS.includes(s))).toEqual(["P1", "P2", "P3"]);
    expect(CATALOG_SKUS.every((s) => skus.includes(s))).toBe(true);
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

  it("flags a day only when it has tours and all of them are completed (NUD-116)", async () => {
    asAdmin();
    const tour = (status: "COMPLETED" | "RELEASED") =>
      t.prisma.tour.create({ data: { date: FUTURE_DATE, status, depotSnapshot: {} } });
    expect(await dayTourCompletedAction(FUTURE)).toBe(false); // no tour
    await tour("COMPLETED");
    expect(await dayTourCompletedAction(FUTURE)).toBe(true);
    expect(await dayTourCompletedAction("2099-06-16")).toBe(false); // other day
    await tour("RELEASED"); // an open follow-up tour absorbs the order
    expect(await dayTourCompletedAction(FUTURE)).toBe(false);
    expect(await dayTourCompletedAction("garbage")).toBe(false);
    await t.prisma.tour.deleteMany({});
  });

  it("lists the orders of the filtered days with items, not other days", async () => {
    asAdmin();
    await createOrderAction(input({ lines: [{ productId: p1, quantity: 4 }] }));
    // A past order can only exist from before (e.g. imported); insert directly.
    await t.prisma.order.create({
      data: {
        customerId,
        deliveryDate: new Date("2020-01-01T00:00:00Z"),
        windowFrom: new Date("2020-01-01T00:00:00Z"),
        windowTo: new Date("2020-01-01T00:00:00Z"),
        status: "CONFIRMED",
        createdById: adminId,
      },
    });
    const { rows } = await orderOverviewQuery({ from: FUTURE, to: FUTURE });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "CONFIRMED",
      source: "MANUAL",
      customer: { customerNumber: "C1" },
      tour: null,
    });
    expect(rows[0]?.items).toHaveLength(1);
    expect(rows[0]?.items[0]?.quantity).toBe(4);
    expect((await orderOverviewQuery({ from: "2020-01-01", to: "2020-01-01" })).rows).toHaveLength(
      1,
    );
  });

  describe("screenshot attachment (NUD-031)", () => {
    it("stores a Screenshot, sets source=SCREENSHOT and shows it in the detail with a signed URL", async () => {
      asAdmin();
      const key = uploadedScreenshot();
      const result = await createOrderAction(input({ screenshotKey: key }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const order = await t.prisma.order.findUniqueOrThrow({
        where: { id: result.id },
        include: { screenshot: true },
      });
      expect(order.source).toBe("SCREENSHOT");
      expect(order.screenshot).toMatchObject({ storageKey: key, uploadedById: adminId });
      expect(order.customerId).toBe(customerId);
      expect(order.createdById).toBe(adminId);

      const detail = await orderDetailQuery(result.id);
      expect(detail?.source).toBe("SCREENSHOT");
      expect(detail?.screenshot?.url).toContain(key);
      expect(detail?.items).toHaveLength(1);
      expect(detail?.customer.customerNumber).toBe("C1");
      expect((await orderOverviewQuery({ from: FUTURE, to: FUTURE })).rows[0]?.source).toBe(
        "SCREENSHOT",
      );
    });

    it("an order without screenshot stays MANUAL and has no screenshot in the detail", async () => {
      asAdmin();
      const result = await createOrderAction(input({ screenshotKey: null }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const detail = await orderDetailQuery(result.id);
      expect(detail).toMatchObject({ source: "MANUAL", screenshot: null });
      expect(await t.prisma.screenshot.count()).toBe(0);
    });

    it("a client-sent source is ignored (only a real screenshot makes SCREENSHOT)", async () => {
      asAdmin();
      const result = await createOrderAction(input({ source: "SCREENSHOT" }));
      expect(result.ok).toBe(true);
      expect(await t.prisma.order.count({ where: { source: "SCREENSHOT" } })).toBe(0);
    });

    it("rejects forged keys: wrong prefix, other uploads, traversal, URLs, wrong extension", async () => {
      asAdmin();
      const uuid = "0000000a-0000-4000-8000-00000000000b";
      const forged = [
        `customers/${uuid}.jpg`,
        `screenshots/${uuid}.gif`,
        `screenshots/${uuid}.jpg/../../x`,
        `screenshots/../customers/${uuid}.jpg`,
        `/screenshots/${uuid}.jpg`,
        `screenshots/${uuid.toUpperCase()}.jpg`,
        `screenshots/not-a-uuid.jpg`,
        `https://evil.example/screenshots/${uuid}.jpg`,
        `screenshots/${uuid}.jpg?x=1`,
        "",
        "screenshots/",
        42,
        { key: "x" },
      ];
      for (const key of forged) {
        // Even if an object existed under the forged key, it must not be accepted.
        if (typeof key === "string") storage.put(key, new Uint8Array(10), "image/jpeg");
        expect(await createOrderAction(input({ screenshotKey: key })), String(key)).toEqual({
          ok: false,
          error: "invalid",
        });
      }
      expect(await t.prisma.order.count()).toBe(0);
      expect(await t.prisma.screenshot.count()).toBe(0);
    });

    it("rejects a key whose object was never uploaded", async () => {
      asAdmin();
      const key = "screenshots/00000002-0000-4000-8000-000000000000.jpg";
      expect(await createOrderAction(input({ screenshotKey: key }))).toEqual({
        ok: false,
        error: "screenshot_missing",
      });
      expect(await t.prisma.order.count()).toBe(0);
    });

    it("rejects an empty or oversize stored object", async () => {
      asAdmin();
      for (const bytes of [0, 15 * 1024 * 1024 + 1]) {
        const key = uploadedScreenshot(bytes);
        expect(await createOrderAction(input({ screenshotKey: key }))).toEqual({
          ok: false,
          error: "invalid",
        });
      }
    });

    it("a screenshot can be attached to one order only", async () => {
      asAdmin();
      const key = uploadedScreenshot();
      expect((await createOrderAction(input({ screenshotKey: key }))).ok).toBe(true);
      expect(await createOrderAction(input({ screenshotKey: key }))).toEqual({
        ok: false,
        error: "screenshot_in_use",
      });
      expect(await t.prisma.order.count()).toBe(1);
      expect(await t.prisma.screenshot.count()).toBe(1);
    });

    it("a rejected order leaves no Screenshot row behind", async () => {
      asAdmin();
      const key = uploadedScreenshot();
      const result = await createOrderAction(
        input({ screenshotKey: key, lines: [{ productId: p1, quantity: 0 }] }),
      );
      expect(result).toEqual({ ok: false, error: "invalid" });
      expect(
        await createOrderAction(input({ screenshotKey: key, customerId: archivedId })),
      ).toEqual({ ok: false, error: "customer_inactive" });
      expect(await t.prisma.screenshot.count()).toBe(0);
    });

    it("preview URL is only signed for existing keys in the screenshot namespace", async () => {
      asAdmin();
      const key = uploadedScreenshot();
      expect(await screenshotPreviewUrlAction(key)).toContain(key);
      storage.put(
        "customers/00000003-0000-4000-8000-000000000000.jpg",
        new Uint8Array(5),
        "image/jpeg",
      );
      for (const bad of [
        "customers/00000003-0000-4000-8000-000000000000.jpg",
        "screenshots/ffffffff-0000-4000-8000-000000000000.jpg",
        "../etc/passwd",
        "",
        null,
        7,
      ]) {
        expect(await screenshotPreviewUrlAction(bad), String(bad)).toBeNull();
      }
    });

    it("detail returns null for unknown or malformed ids", async () => {
      asAdmin();
      expect(await orderDetailQuery("does-not-exist")).toBeNull();
      expect(await orderDetailQuery("")).toBeNull();
      expect(await orderDetailQuery(undefined)).toBeNull();
    });
  });
});
