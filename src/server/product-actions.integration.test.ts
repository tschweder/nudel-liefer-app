// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hansToHk, hansToTw } from "@/lib/opencc";

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

const {
  createProductAction,
  deriveHantAction,
  moveProductAction,
  setProductActiveAction,
  updateProductAction,
} = await import("./product-actions");
const { activeProductsQuery, getProductQuery, listProductsQuery } =
  await import("./product-queries");

const valid = {
  sku: "tst-1",
  unit: "PACK",
  name: { de: "Schraubennudeln", hans: "螺旋意面", hk: "", tw: "" },
  hkAuto: true,
  twAuto: true,
};

describe.skipIf(!process.env.DATABASE_URL)("product catalog", { timeout: 60_000 }, () => {
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

  beforeEach(async () => {
    state.session = null;
    await t.prisma.orderItem.deleteMany();
    await t.prisma.order.deleteMany();
    await t.prisma.product.deleteMany();
  });

  const asAdmin = () => {
    state.session = { user: { id: adminId } };
  };

  async function create(overrides: Record<string, unknown> = {}) {
    asAdmin();
    const result = await createProductAction({ ...valid, ...overrides });
    if (!result.ok) throw new Error(`create failed: ${result.error}`);
    return result.id;
  }

  const skus = async () => (await listProductsQuery()).map((p) => p.sku);

  it("rejects anonymous callers, drivers and deactivated admins on every action and read", async () => {
    const id = await create({ sku: "AUTH-1" });
    const calls: Array<() => Promise<unknown>> = [
      () => createProductAction({ ...valid, sku: "AUTH-2" }),
      () => updateProductAction(id, { ...valid, sku: "AUTH-1", name: { ...valid.name, de: "X" } }),
      () => setProductActiveAction(id, false),
      () => moveProductAction(id, "down"),
      () => deriveHantAction("面"),
      () => listProductsQuery(),
      () => activeProductsQuery(),
      () => getProductQuery(id),
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
    const row = await t.prisma.product.findUniqueOrThrow({ where: { id } });
    expect(row.active).toBe(true);
    expect(await t.prisma.product.count()).toBe(1);
  });

  it("rejects a product without a Simplified Chinese name (or German name, or SKU)", async () => {
    asAdmin();
    for (const name of [
      { ...valid.name, hans: "" },
      { ...valid.name, hans: "   " },
      { ...valid.name, de: "" },
    ]) {
      expect(await createProductAction({ ...valid, name })).toEqual({
        ok: false,
        error: "invalid",
      });
    }
    const withoutHans = { de: valid.name.de, hk: "", tw: "" };
    expect(await createProductAction({ ...valid, name: withoutHans })).toEqual({
      ok: false,
      error: "invalid",
    });
    expect(await createProductAction({ ...valid, sku: "" })).toMatchObject({ ok: false });
    expect(await createProductAction({ ...valid, sku: "bad sku!" })).toMatchObject({ ok: false });
    expect(await createProductAction({ ...valid, unit: "BOX" })).toMatchObject({ ok: false });
    expect(await createProductAction("nonsense")).toMatchObject({ ok: false });
    expect(await t.prisma.product.count()).toBe(0);
  });

  it("derives both Traditional names from Simplified with OpenCC and marks them as machine", async () => {
    const id = await create();
    const row = await t.prisma.product.findUniqueOrThrow({ where: { id } });
    expect(row.sku).toBe("TST-1");
    expect(row.name).toMatchObject({
      de: "Schraubennudeln",
      "zh-Hans": "螺旋意面",
      "zh-Hant-HK": hansToHk("螺旋意面"),
      "zh-Hant-TW": hansToTw("螺旋意面"),
      meta: { source: "de", machine: { "zh-Hant-HK": true, "zh-Hant-TW": true } },
    });
    expect((row.name as Record<string, string>)["zh-Hant-HK"]).toBe("螺旋意麪");
    expect((row.name as Record<string, string>)["zh-Hant-TW"]).toBe("螺旋意麵");
  });

  it("recomputes an auto name on the server and keeps a hand-edited one", async () => {
    const id = await create({
      name: { de: "Fusilli", hans: "螺旋意面", hk: "FALSCH", tw: "Handarbeit 麵" },
      hkAuto: true,
      twAuto: false,
    });
    const row = await t.prisma.product.findUniqueOrThrow({ where: { id } });
    expect(row.name).toMatchObject({
      "zh-Hant-HK": hansToHk("螺旋意面"),
      "zh-Hant-TW": "Handarbeit 麵",
      meta: { machine: { "zh-Hant-HK": true } },
    });
    expect(
      (row.name as { meta: { machine: Record<string, boolean> } }).meta.machine,
    ).not.toHaveProperty("zh-Hant-TW");
    // Editing Simplified keeps the hand-edited TW name and refreshes the auto HK name.
    asAdmin();
    const result = await updateProductAction(id, {
      sku: "TST-1",
      unit: "PACK",
      name: { de: "Fusilli", hans: "笔管面", hk: "x", tw: "Handarbeit 麵" },
      hkAuto: true,
      twAuto: false,
    });
    expect(result.ok).toBe(true);
    const updated = await t.prisma.product.findUniqueOrThrow({ where: { id } });
    expect(updated.name).toMatchObject({
      "zh-Hans": "笔管面",
      "zh-Hant-HK": hansToHk("笔管面"),
      "zh-Hant-TW": "Handarbeit 麵",
    });
    const form = await getProductQuery(id);
    expect(form).toMatchObject({ hkAuto: true, twAuto: false, unitLocked: false });
  });

  it("derives an empty, non-auto Traditional field instead of storing an empty name", async () => {
    const id = await create({ hkAuto: false, twAuto: false });
    const row = await t.prisma.product.findUniqueOrThrow({ where: { id } });
    expect((row.name as Record<string, string>)["zh-Hant-HK"]).toBe(hansToHk("螺旋意面"));
  });

  it("rejects duplicate SKUs case-insensitively", async () => {
    const id = await create({ sku: "dup-1" });
    asAdmin();
    expect(await createProductAction({ ...valid, sku: "DUP-1" })).toEqual({
      ok: false,
      error: "sku_taken",
    });
    const other = await create({ sku: "dup-2" });
    expect(await updateProductAction(other, { ...valid, sku: "Dup-1", name: valid.name })).toEqual({
      ok: false,
      error: "sku_taken",
    });
    expect(await updateProductAction(id, { ...valid, sku: "dup-1" })).toEqual({ ok: true, id });
  });

  it("appends new products to the end and reorders with up/down", async () => {
    const a = await create({ sku: "A" });
    const b = await create({ sku: "B" });
    const c = await create({ sku: "C" });
    expect(await skus()).toEqual(["A", "B", "C"]);
    expect(await moveProductAction(c, "up")).toEqual({ ok: true });
    expect(await skus()).toEqual(["A", "C", "B"]);
    expect(await moveProductAction(a, "down")).toEqual({ ok: true });
    expect(await skus()).toEqual(["C", "A", "B"]);
    // Ends are no-ops.
    await moveProductAction(c, "up");
    await moveProductAction(b, "down");
    expect(await skus()).toEqual(["C", "A", "B"]);
    expect((await listProductsQuery()).map((p) => p.sortOrder)).toEqual([0, 1, 2]);
    expect(await moveProductAction("nope", "up")).toEqual({ ok: false, error: "not_found" });
    expect(await moveProductAction(a, "sideways")).toEqual({ ok: false, error: "invalid" });
  });

  it("repairs tied sort orders when moving", async () => {
    const ids = [
      await create({ sku: "T1" }),
      await create({ sku: "T2" }),
      await create({ sku: "T3" }),
    ];
    await t.prisma.product.updateMany({ data: { sortOrder: 5 } });
    await moveProductAction(ids[2]!, "up");
    expect((await listProductsQuery()).map((p) => p.sortOrder)).toEqual([0, 1, 2]);
  });

  it("getActiveProducts (order picker) hides inactive products in sort order; old orders keep them", async () => {
    const a = await create({ sku: "A" });
    const b = await create({ sku: "B" });
    await create({ sku: "C" });
    const customer = await t.prisma.customer.create({
      data: {
        customerNumber: "K1",
        name: "K",
        street: "S 1",
        postalCode: "1010",
        city: "Wien",
      },
    });
    await t.prisma.order.create({
      data: {
        customerId: customer.id,
        deliveryDate: new Date("2026-11-02"),
        status: "CONFIRMED",
        createdById: adminId,
        items: { create: [{ productId: b, quantity: 3 }] },
      },
    });
    expect((await activeProductsQuery()).map((p) => p.sku)).toEqual(["A", "B", "C"]);
    expect(await setProductActiveAction(b, false)).toEqual({ ok: true });
    expect((await activeProductsQuery()).map((p) => p.sku)).toEqual(["A", "C"]);
    expect(await skus()).toEqual(["A", "B", "C"]); // still listed for the admin
    // The product row and the old order item survive (soft delete only).
    const item = await t.prisma.orderItem.findFirstOrThrow({ include: { product: true } });
    expect(item.product).toMatchObject({ id: b, active: false });
    // Reordering moves through inactive products too; the picker keeps the relative order.
    await moveProductAction(a, "down");
    expect(await skus()).toEqual(["B", "A", "C"]);
    expect((await activeProductsQuery()).map((p) => p.sku)).toEqual(["A", "C"]);
    expect(await setProductActiveAction(b, true)).toEqual({ ok: true });
    expect((await activeProductsQuery()).map((p) => p.sku)).toContain("B");
    expect(await setProductActiveAction("nope", true)).toEqual({ ok: false, error: "not_found" });
    expect(await setProductActiveAction(a, "yes")).toEqual({ ok: false, error: "invalid" });
  });

  it("does not allow changing the unit of a product that is on an order", async () => {
    const id = await create({ sku: "U1" });
    expect(await updateProductAction(id, { ...valid, sku: "U1", unit: "KG" })).toEqual({
      ok: true,
      id,
    });
    const customer = await t.prisma.customer.create({
      data: { customerNumber: "K2", name: "K", street: "S 1", postalCode: "1010", city: "Wien" },
    });
    await t.prisma.order.create({
      data: {
        customerId: customer.id,
        deliveryDate: new Date("2026-11-02"),
        createdById: adminId,
        items: { create: [{ productId: id, quantity: 1 }] },
      },
    });
    expect(await updateProductAction(id, { ...valid, sku: "U1", unit: "CRATE" })).toEqual({
      ok: false,
      error: "unit_locked",
    });
    expect((await t.prisma.product.findUniqueOrThrow({ where: { id } })).unit).toBe("KG");
    expect(await getProductQuery(id)).toMatchObject({ unitLocked: true });
    // Names stay editable.
    expect((await updateProductAction(id, { ...valid, sku: "U1", unit: "KG" })).ok).toBe(true);
  });

  it("deriveHantAction returns the OpenCC output for the live pre-fill", async () => {
    asAdmin();
    expect(await deriveHantAction("螺旋意面")).toEqual({
      ok: true,
      hk: hansToHk("螺旋意面"),
      tw: hansToTw("螺旋意面"),
    });
    expect(await deriveHantAction(42)).toEqual({ ok: false });
    expect(await deriveHantAction("x".repeat(500))).toEqual({ ok: false });
  });
});
