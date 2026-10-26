// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hashSecret } from "./auth/password";
import { createTestDb, type TestDb } from "./test-db";
import { setTranslatorForTests } from "./translator";
import { FakeTranslator } from "./translator/fake";
import { type Translator, TranslatorError } from "./translator/types";

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
  createCustomerAction,
  retranslateNoteAction,
  saveNoteTranslationsAction,
  setCustomerActiveAction,
  updateCustomerAction,
} = await import("./customer-actions");
const { getCustomerQuery, nextCustomerNumberQuery, noteTranslationsQuery, upcomingOrdersQuery } =
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
      () => noteTranslationsQuery(existing.id),
      () =>
        saveNoteTranslationsAction({
          customerId: existing.id,
          baseUpdatedAt: "x",
          values: { cs: "Hacked" },
        }),
      () => retranslateNoteAction(existing.id),
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
    expect(row.notes).not.toHaveProperty("cs", "Hacked");
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
    const notes = stored.notes as { meta: object };
    // A hand-written Chinese text (no machine flag).
    const withZh = { ...notes, "zh-Hans": "走后门", meta: { ...notes.meta, machine: {} } };
    await t.prisma.customer.update({ where: { id }, data: { notes: withZh } });
    await updateCustomerAction(id, { ...valid, customerNumber: "NOTE-1", name: "Andere" });
    expect((await t.prisma.customer.findUniqueOrThrow({ where: { id } })).notes).toEqual(withZh);
    await updateCustomerAction(id, { ...valid, customerNumber: "NOTE-1", notes: "Anders" });
    const changed = await t.prisma.customer.findUniqueOrThrow({ where: { id } });
    expect(notesText(changed.notes)).toBe("Anders");
    // The Chinese text has no machine flag = hand-written: kept, but flagged for a check (NUD-071).
    expect(changed.notes).toMatchObject({
      "zh-Hans": "走后门",
      meta: { stale: { "zh-Hans": true } },
    });
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
        weightKgPerUnit: 1,
      },
    });
    const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
    const order = (
      customerId: string,
      date: string,
      status: "DRAFT" | "CONFIRMED" | "CANCELLED",
      qty: number,
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
    await order(id, "2026-10-16", "CONFIRMED", 1); // yesterday
    await order(id, "2026-10-17", "CONFIRMED", 3); // today
    await order(id, "2026-10-20", "DRAFT", 4);
    await order(id, "2026-10-21", "CANCELLED", 9);
    await order(other.id, "2026-10-20", "CONFIRMED", 7);

    // 2026-10-17 01:30 in Vienna is still 16 October 23:30 UTC: the factory day decides.
    const now = new Date("2026-10-16T23:30:00Z");
    const orders = await listUpcomingOrders(t.prisma, id, "Europe/Vienna", now);
    expect(orders.map((o) => [o.deliveryDate.toISOString().slice(0, 10), o.status])).toEqual([
      ["2026-10-17", "CONFIRMED"],
      ["2026-10-20", "DRAFT"],
    ]);
    expect(orders[0]!.items).toMatchObject([{ quantity: 3, unit: "PACK" }]);
    // In UTC it is still 16 October, so yesterday's order is the first one.
    const utc = await listUpcomingOrders(t.prisma, id, "UTC", now);
    expect(utc).toHaveLength(3);
    asAdmin();
    expect(Array.isArray(await upcomingOrdersQuery(id))).toBe(true);
  });

  describe("note translations (NUD-071)", () => {
    const NOTE = "Hintereingang benutzen, nach 10 Uhr klingeln";
    const notesOf = async (id: string) =>
      (await t.prisma.customer.findUniqueOrThrow({ where: { id } })).notes as Record<
        string,
        unknown
      > & {
        meta: {
          machine: Record<string, boolean>;
          stale?: Record<string, boolean>;
          updatedAt: string;
          pendingTranslation?: boolean;
        };
      };

    /** The provider is down while `state.up` is false. */
    function flaky() {
      const state = { up: true, calls: 0 };
      const inner = new FakeTranslator();
      const translator: Translator = {
        kind: "deepl",
        async translate(text, from, to) {
          state.calls++;
          if (!state.up) throw new TranslatorError("outage", "HTTP", 503);
          return inner.translate(text, from, to);
        },
      };
      return { state, translator };
    }

    beforeEach(() => setTranslatorForTests(new FakeTranslator()));
    afterAll(() => setTranslatorForTests(undefined));

    it("localizes the German note on create; machine flags on the four translated versions only", async () => {
      const { id } = await create({ customerNumber: "TR-1", notes: NOTE });
      const notes = await notesOf(id);
      expect(notes.de).toBe(NOTE);
      expect(notes["zh-Hans"]).toBe(`[zh-Hans] ${NOTE}`);
      expect(notes.en).toBe(`[en] ${NOTE}`);
      expect(notes["sr-Latn"]).toBe(`[sr-Latn] ${NOTE}`);
      expect(notes.cs).toBe(`[cs] ${NOTE}`);
      expect(notes.meta.machine).toEqual({
        en: true,
        "sr-Latn": true,
        cs: true,
        "zh-Hans": true,
      });
      expect(notes.meta.pendingTranslation).toBeUndefined();
    });

    it("saving never fails when the provider is down: source stored, translation pending", async () => {
      const { state, translator } = flaky();
      state.up = false;
      setTranslatorForTests(translator);
      const { id } = await create({ customerNumber: "TR-2", notes: NOTE });
      const notes = await notesOf(id);
      expect(notes.de).toBe(NOTE);
      expect(notes.meta.pendingTranslation).toBe(true);
      expect(notes["zh-Hans"]).toBeUndefined();
    });

    it("hand-written Czech text survives a German source change and is flagged; machine ones follow", async () => {
      const { id } = await create({ customerNumber: "TR-3", notes: NOTE });
      const first = await noteTranslationsQuery(id);
      expect(first).not.toBeNull();
      const saved = await saveNoteTranslationsAction({
        customerId: id,
        baseUpdatedAt: first!.updatedAt,
        values: { cs: "Použijte zadní vchod, zvonit po desáté" },
      });
      expect(saved.ok).toBe(true);
      let notes = await notesOf(id);
      expect(notes.cs).toBe("Použijte zadní vchod, zvonit po desáté");
      expect(notes.meta.machine).toEqual({ en: true, "sr-Latn": true, "zh-Hans": true });
      expect(notes.meta.updatedAt).not.toBe(first!.updatedAt);

      const NEW = "Seiteneingang benutzen, ab 9 Uhr klingeln";
      expect(
        await updateCustomerAction(id, { ...valid, customerNumber: "TR-3", notes: NEW }),
      ).toMatchObject({ ok: true });
      notes = await notesOf(id);
      expect(notes.de).toBe(NEW);
      expect(notes.cs).toBe("Použijte zadní vchod, zvonit po desáté");
      expect(notes.meta.stale).toEqual({ cs: true });
      expect(notes["zh-Hans"]).toBe(`[zh-Hans] ${NEW}`);
      expect(notes["sr-Latn"]).toBe(`[sr-Latn] ${NEW}`);
      expect(notes.meta.machine).toEqual({ en: true, "sr-Latn": true, "zh-Hans": true });

      const view = await noteTranslationsQuery(id);
      expect(view?.rows.find((r) => r.locale === "cs")).toMatchObject({
        kind: "manual",
        stale: true,
      });
      // Checking the version clears the flag without touching the text.
      const checked = await saveNoteTranslationsAction({
        customerId: id,
        baseUpdatedAt: view!.updatedAt,
        values: {},
        reviewed: ["cs"],
      });
      expect(checked.ok).toBe(true);
      notes = await notesOf(id);
      expect(notes.meta.stale).toBeUndefined();
      expect(notes.cs).toBe("Použijte zadní vchod, zvonit po desáté");
    });

    it("editing the German text in the tab re-translates machine versions only", async () => {
      const { id } = await create({ customerNumber: "TR-4", notes: NOTE });
      const view = await noteTranslationsQuery(id);
      const result = await saveNoteTranslationsAction({
        customerId: id,
        baseUpdatedAt: view!.updatedAt,
        values: { de: "Klingeln", "sr-Latn": "Zvonite" },
      });
      expect(result.ok).toBe(true);
      const notes = await notesOf(id);
      expect(notes.de).toBe("Klingeln");
      expect(notes["zh-Hans"]).toBe("[zh-Hans] Klingeln");
      expect(notes["sr-Latn"]).toBe("Zvonite");
      expect(notes.meta.stale).toBeUndefined();
    });

    it("rejects invalid input, stale versions and notes that do not exist", async () => {
      const { id } = await create({ customerNumber: "TR-5", notes: NOTE });
      const view = await noteTranslationsQuery(id);
      const base = { customerId: id, baseUpdatedAt: view!.updatedAt };
      expect(await saveNoteTranslationsAction({ ...base, values: { de: "  " } })).toEqual({
        ok: false,
        error: "invalid",
      });
      expect(
        await saveNoteTranslationsAction({ ...base, values: { "zh-Hans": "x".repeat(2001) } }),
      ).toEqual({ ok: false, error: "invalid" });
      expect(await saveNoteTranslationsAction({ ...base, values: { fr: "non" } })).toMatchObject({
        ok: true, // unknown keys are ignored, never stored
      });
      expect(await notesOf(id)).not.toHaveProperty("fr");
      expect(
        await saveNoteTranslationsAction({ ...base, values: { "zh-Hans": "旧状态" } }),
      ).toEqual({ ok: false, error: "conflict" });
      expect(await saveNoteTranslationsAction({ ...base, customerId: "nope", values: {} })).toEqual(
        { ok: false, error: "not_found" },
      );
      const noNote = await create({ customerNumber: "TR-6", notes: "" });
      expect(
        await saveNoteTranslationsAction({ customerId: noNote.id, baseUpdatedAt: "x", values: {} }),
      ).toEqual({ ok: false, error: "no_notes" });
      expect(await noteTranslationsQuery(noNote.id)).toBeNull();
      expect(await retranslateNoteAction(noNote.id)).toEqual({ ok: false, error: "no_notes" });
    });

    it("re-translate overwrites hand-written versions; a provider outage changes nothing", async () => {
      const { id } = await create({ customerNumber: "TR-7", notes: NOTE });
      const view = await noteTranslationsQuery(id);
      await saveNoteTranslationsAction({
        customerId: id,
        baseUpdatedAt: view!.updatedAt,
        values: { "zh-Hans": "手写" },
      });
      const before = await notesOf(id);
      const { state, translator } = flaky();
      state.up = false;
      setTranslatorForTests(translator);
      expect(await retranslateNoteAction(id)).toEqual({ ok: false, error: "translation_failed" });
      expect(await notesOf(id)).toEqual(before);

      state.up = true;
      const result = await retranslateNoteAction(id);
      expect(result.ok).toBe(true);
      const notes = await notesOf(id);
      expect(notes["zh-Hans"]).toBe(`[zh-Hans] ${NOTE}`);
      expect(notes.meta.machine).toEqual({
        en: true,
        "sr-Latn": true,
        cs: true,
        "zh-Hans": true,
      });
      expect(notes.meta.updatedAt).not.toBe(before.meta.updatedAt);
    });

    it("a source change while the provider is down keeps hand-written text and marks the rest pending", async () => {
      const { id } = await create({ customerNumber: "TR-8", notes: NOTE });
      const view = await noteTranslationsQuery(id);
      await saveNoteTranslationsAction({
        customerId: id,
        baseUpdatedAt: view!.updatedAt,
        values: { cs: "ručně" },
      });
      const { state, translator } = flaky();
      state.up = false;
      setTranslatorForTests(translator);
      await updateCustomerAction(id, { ...valid, customerNumber: "TR-8", notes: "Neu" });
      const notes = await notesOf(id);
      expect(notes.de).toBe("Neu");
      expect(notes.cs).toBe("ručně");
      expect(notes.meta.stale).toEqual({ cs: true });
      expect(notes["zh-Hans"]).toBeUndefined();
      expect(notes.meta.pendingTranslation).toBe(true);
    });

    it("a concurrent change of the note makes the save fail instead of overwriting it", async () => {
      const { id } = await create({ customerNumber: "TR-9", notes: NOTE });
      const view = await noteTranslationsQuery(id);
      const stored = await notesOf(id);
      await t.prisma.customer.update({
        where: { id },
        data: {
          notes: { ...stored, meta: { ...stored.meta, updatedAt: "2099-01-01T00:00:00.000Z" } },
        },
      });
      expect(
        await saveNoteTranslationsAction({
          customerId: id,
          baseUpdatedAt: view!.updatedAt,
          values: { "zh-Hans": "x" },
        }),
      ).toEqual({ ok: false, error: "conflict" });
    });
  });
});
