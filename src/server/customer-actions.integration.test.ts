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

const { createCustomerAction, setCustomerActiveAction, updateCustomerAction } =
  await import("./customer-actions");
const { getCustomerQuery, nextCustomerNumberQuery, upcomingOrdersQuery } =
  await import("./customer-queries");
const { listUpcomingOrders, notesText } = await import("./customer-admin");

const valid = {
  customerNumber: "1001",
  name: "Trattoria Bella",
  street: "Hauptstraße 1",
  postalCode: "1010",
  city: "Wien",
  country: "at",
  lat: 48.2082123,
  lng: 16.3738,
  pinConfirmed: true,
  deliveryHoursInfo: " Mo-Fr 6-10 ",
  notes: "Hintereingang benutzen",
};

describe.skipIf(!process.env.DATABASE_URL)("customer admin actions", { timeout: 60_000 }, () => {
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
  });

  const asAdmin = () => {
    state.session = { user: { id: adminId } };
  };

  async function create(overrides: Record<string, unknown> = {}) {
    asAdmin();
    const result = await createCustomerAction({ ...valid, ...overrides });
    if (!result.ok) throw new Error(`create failed: ${result.error}`);
    return result;
  }

  it("rejects anonymous callers, drivers and deactivated admins on every action and read", async () => {
    asAdmin();
    const existing = await createCustomerAction({ ...valid, customerNumber: "AUTH-1" });
    if (!existing.ok) throw new Error("setup failed");
    const before = await t.prisma.customer.count();

    const calls: Array<() => Promise<unknown>> = [
      () => createCustomerAction({ ...valid, customerNumber: "AUTH-2" }),
      () => updateCustomerAction(existing.id, { ...valid, name: "Hacked" }),
      () => setCustomerActiveAction(existing.id, false),
      () => getCustomerQuery(existing.id),
      () => nextCustomerNumberQuery(),
      () => upcomingOrdersQuery(existing.id),
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
    expect(await t.prisma.customer.count()).toBe(before);
    const row = await t.prisma.customer.findUniqueOrThrow({ where: { id: existing.id } });
    expect(row.name).toBe("Trattoria Bella");
    expect(row.active).toBe(true);
  });

  it("creates a normalized customer with a confirmed pin and German notes", async () => {
    const result = await create({ customerNumber: "  C-1  " });
    expect(result.pinConfirmed).toBe(true);
    const row = await t.prisma.customer.findUniqueOrThrow({ where: { id: result.id } });
    expect(row).toMatchObject({
      customerNumber: "C-1",
      country: "AT",
      lat: 48.208212,
      lng: 16.3738,
      pinConfirmed: true,
      deliveryHoursInfo: "Mo-Fr 6-10",
      active: true,
    });
    expect(row.notes).toMatchObject({ de: "Hintereingang benutzen", meta: { source: "de" } });
    expect(notesText(row.notes)).toBe("Hintereingang benutzen");
    // The search column is maintained by the trigger, so the new customer is findable.
    expect(row.searchText).toContain("trattoria");
  });

  it("stores no pin confirmation without coordinates", async () => {
    const result = await create({
      customerNumber: "C-2",
      lat: null,
      lng: null,
      pinConfirmed: true,
      notes: "",
      deliveryHoursInfo: "",
    });
    expect(result.pinConfirmed).toBe(false);
    const row = await t.prisma.customer.findUniqueOrThrow({ where: { id: result.id } });
    expect(row).toMatchObject({ lat: null, lng: null, pinConfirmed: false, notes: null });
    expect(row.deliveryHoursInfo).toBeNull();
  });

  it("does not confirm the pin unless the admin asked for it", async () => {
    const result = await create({ customerNumber: "C-3", pinConfirmed: false });
    expect(result.pinConfirmed).toBe(false);
  });

  it("rejects a duplicate customer number (case-insensitive) on create", async () => {
    await create({ customerNumber: "DUP-1" });
    asAdmin();
    expect(await createCustomerAction({ ...valid, customerNumber: "DUP-1" })).toEqual({
      ok: false,
      error: "number_taken",
    });
    expect(await createCustomerAction({ ...valid, customerNumber: "dup-1" })).toEqual({
      ok: false,
      error: "number_taken",
    });
    expect(
      await t.prisma.customer.count({ where: { customerNumber: { startsWith: "DUP-" } } }),
    ).toBe(1);
  });

  it("rejects a duplicate number on update but allows keeping the own number", async () => {
    const a = await create({ customerNumber: "UPD-A" });
    const b = await create({ customerNumber: "UPD-B" });
    expect(await updateCustomerAction(b.id, { ...valid, customerNumber: "UPD-A" })).toEqual({
      ok: false,
      error: "number_taken",
    });
    expect(await updateCustomerAction(a.id, { ...valid, customerNumber: "UPD-A" })).toMatchObject({
      ok: true,
    });
    expect(await updateCustomerAction(a.id, { ...valid, customerNumber: "upd-a" })).toMatchObject({
      ok: true,
    });
  });

  it.each([
    ["blank number", { customerNumber: "   " }],
    ["blank name", { name: " " }],
    ["blank street", { street: "" }],
    ["blank postal code", { postalCode: "" }],
    ["blank city", { city: "" }],
    ["3-letter country", { country: "AUT" }],
    ["numeric country", { country: "12" }],
    ["latitude out of range", { lat: 91 }],
    ["longitude out of range", { lng: -181 }],
    ["latitude without longitude", { lng: null }],
    ["NaN latitude", { lat: Number.NaN }],
    ["name too long", { name: "x".repeat(161) }],
    ["notes too long", { notes: "x".repeat(2001) }],
    ["pinConfirmed not boolean", { pinConfirmed: "yes" }],
    ["number is not a string", { customerNumber: 5 }],
  ])("rejects invalid input: %s", async (_label, change) => {
    asAdmin();
    const before = await t.prisma.customer.count();
    expect(await createCustomerAction({ ...valid, customerNumber: "BAD-1", ...change })).toEqual({
      ok: false,
      error: "invalid",
    });
    expect(await createCustomerAction("nonsense")).toEqual({ ok: false, error: "invalid" });
    expect(await createCustomerAction(null)).toEqual({ ok: false, error: "invalid" });
    expect(await t.prisma.customer.count()).toBe(before);
  });

  it("editing the street without moving the pin resets pinConfirmed", async () => {
    const { id } = await create({ customerNumber: "PIN-1" });
    // Asking for the confirmation again for the changed address with the old pin is not enough.
    const result = await updateCustomerAction(id, {
      ...valid,
      customerNumber: "PIN-1",
      street: "Nebengasse 7",
      pinConfirmed: true,
    });
    expect(result).toMatchObject({ ok: true, pinConfirmed: false });
    const row = await t.prisma.customer.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ street: "Nebengasse 7", pinConfirmed: false });
  });

  it("editing the street and moving the pin allows a new confirmation", async () => {
    const { id } = await create({ customerNumber: "PIN-2" });
    const result = await updateCustomerAction(id, {
      ...valid,
      customerNumber: "PIN-2",
      street: "Nebengasse 7",
      lat: 48.21,
      lng: 16.38,
      pinConfirmed: true,
    });
    expect(result).toMatchObject({ ok: true, pinConfirmed: true });
    expect(await t.prisma.customer.findUniqueOrThrow({ where: { id } })).toMatchObject({
      lat: 48.21,
      lng: 16.38,
      pinConfirmed: true,
    });
  });

  it("keeps the confirmation when only name, hours or notes change", async () => {
    const { id } = await create({ customerNumber: "PIN-3" });
    const result = await updateCustomerAction(id, {
      ...valid,
      customerNumber: "PIN-3",
      name: "Neuer Name",
      deliveryHoursInfo: "",
      notes: "Neu",
    });
    expect(result).toMatchObject({ ok: true, pinConfirmed: true });
  });

  it("keeps stored LocalizedText notes untouched when the German text is unchanged", async () => {
    const { id } = await create({ customerNumber: "NOTE-1" });
    const stored = await t.prisma.customer.findUniqueOrThrow({ where: { id } });
    const withZh = { ...(stored.notes as object), "zh-Hans": "走后门" };
    await t.prisma.customer.update({ where: { id }, data: { notes: withZh } });
    await updateCustomerAction(id, { ...valid, customerNumber: "NOTE-1", name: "Andere" });
    expect((await t.prisma.customer.findUniqueOrThrow({ where: { id } })).notes).toEqual(withZh);
    await updateCustomerAction(id, { ...valid, customerNumber: "NOTE-1", notes: "Anders" });
    const changed = await t.prisma.customer.findUniqueOrThrow({ where: { id } });
    expect(notesText(changed.notes)).toBe("Anders");
    expect(changed.notes).not.toHaveProperty("zh-Hans");
    await updateCustomerAction(id, { ...valid, customerNumber: "NOTE-1", notes: "  " });
    expect((await t.prisma.customer.findUniqueOrThrow({ where: { id } })).notes).toBeNull();
  });

  it("reports unknown customers and invalid ids", async () => {
    asAdmin();
    expect(await updateCustomerAction("does-not-exist", valid)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await updateCustomerAction(42, valid)).toEqual({ ok: false, error: "invalid" });
    expect(await setCustomerActiveAction("does-not-exist", false)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await setCustomerActiveAction("x", "no")).toEqual({ ok: false, error: "invalid" });
    expect(await getCustomerQuery("does-not-exist")).toBeNull();
  });

  it("archives and reactivates (soft delete, the row stays)", async () => {
    const { id } = await create({ customerNumber: "ARC-1" });
    expect(await setCustomerActiveAction(id, false)).toEqual({ ok: true });
    expect((await t.prisma.customer.findUniqueOrThrow({ where: { id } })).active).toBe(false);
    expect((await getCustomerQuery(id))?.active).toBe(false);
    expect(await setCustomerActiveAction(id, true)).toEqual({ ok: true });
    expect((await t.prisma.customer.findUniqueOrThrow({ where: { id } })).active).toBe(true);
  });

  it("detail read reports current photos", async () => {
    const { id } = await create({ customerNumber: "PH-1" });
    expect(await getCustomerQuery(id)).toMatchObject({
      hasStorePhoto: false,
      hasParkingPhoto: false,
      notes: "Hintereingang benutzen",
    });
    const photo = (kind: "STORE" | "PARKING", isCurrent: boolean) =>
      t.prisma.photo.create({
        data: {
          customerId: id,
          kind,
          storageKey: `k/${kind}/${isCurrent}`,
          width: 1,
          height: 1,
          bytes: 1,
          uploadedById: adminId,
          isCurrent,
        },
      });
    await photo("STORE", true);
    await photo("PARKING", false);
    expect(await getCustomerQuery(id)).toMatchObject({
      hasStorePhoto: true,
      hasParkingPhoto: false,
    });
  });

  it("suggests a customer number that is still free", async () => {
    asAdmin();
    await create({ customerNumber: "K-0099" });
    const suggested = await nextCustomerNumberQuery();
    expect(await t.prisma.customer.findUnique({ where: { customerNumber: suggested } })).toBeNull();
    await create({ customerNumber: "K-9999" });
    expect(await nextCustomerNumberQuery()).toBe("K-10000");
  });

  it("lists upcoming orders: today and later, not cancelled, real data", async () => {
    const { id } = await create({ customerNumber: "ORD-1" });
    const other = await create({ customerNumber: "ORD-2" });
    const product = await t.prisma.product.create({
      data: {
        sku: "SPAG-5",
        name: {
          de: "Spaghetti 5 kg",
          "zh-Hans": "意大利面 5 公斤",
          meta: { source: "de", machine: {}, updatedAt: "x" },
        },
        unit: "PACK",
      },
    });
    const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
    const order = (
      customerId: string,
      date: string,
      status: "DRAFT" | "CONFIRMED" | "CANCELLED",
      qty: string,
    ) =>
      t.prisma.order.create({
        data: {
          customerId,
          deliveryDate: day(date),
          status,
          createdById: adminId,
          items: { create: [{ productId: product.id, quantity: qty }] },
        },
      });
    await order(id, "2026-10-16", "CONFIRMED", "1"); // yesterday
    await order(id, "2026-10-17", "CONFIRMED", "2.5"); // today
    await order(id, "2026-10-20", "DRAFT", "4");
    await order(id, "2026-10-21", "CANCELLED", "9");
    await order(other.id, "2026-10-20", "CONFIRMED", "7");

    // 2026-10-17 01:30 in Vienna is still 16 October 23:30 UTC: the factory day decides.
    const now = new Date("2026-10-16T23:30:00Z");
    const orders = await listUpcomingOrders(t.prisma, id, "Europe/Vienna", now);
    expect(orders.map((o) => [o.deliveryDate.toISOString().slice(0, 10), o.status])).toEqual([
      ["2026-10-17", "CONFIRMED"],
      ["2026-10-20", "DRAFT"],
    ]);
    expect(orders[0]!.items).toMatchObject([{ quantity: "2.5", unit: "PACK" }]);
    // In UTC it is still 16 October, so yesterday's order is the first one.
    const utc = await listUpcomingOrders(t.prisma, id, "UTC", now);
    expect(utc).toHaveLength(3);
    asAdmin();
    expect(Array.isArray(await upcomingOrdersQuery(id))).toBe(true);
  });
});
