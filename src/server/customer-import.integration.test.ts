// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { buildRecords, type ImportRecord, suggestMapping } from "@/domain/customer-import";
import { parseCsv } from "@/domain/import-file";
import { customerImportRows, toCsv } from "@/domain/testing/import-fixtures";

import { hashSecret } from "./auth/password";
import { FakeGeocoder } from "./geocoder/fake";
import { type Geocoder, GeocoderError } from "./geocoder/types";
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

const actions = await import("./customer-import-actions");
const queries = await import("./customer-queries");
const { commitImport, previewImport } = await import("./customer-import");
const { confirmPin, geocodeCustomers, listCustomerIdsWithoutPin, listPinReviewQueue } =
  await import("./customer-pins");
const { setGeocoderForTests } = await import("./geocoder");

function fixtureRecords(): Array<{ line: number; values: ImportRecord }> {
  const table = parseCsv(toCsv(customerImportRows()));
  const mapping = suggestMapping(table.rows[0]!);
  return buildRecords(table, mapping).map(({ line, record }) => ({ line, values: record }));
}

const noWait = async () => {};

describe.skipIf(!process.env.DATABASE_URL)("customer import", { timeout: 120_000 }, () => {
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
    setGeocoderForTests(new FakeGeocoder());
  }, 60_000);

  afterAll(async () => {
    setGeocoderForTests(undefined);
    await t?.teardown();
  });

  beforeEach(() => {
    state.session = { user: { id: adminId } };
  });

  const clean = () => t.prisma.customer.deleteMany({});

  it("rejects anonymous callers, drivers and deactivated admins on every action and read", async () => {
    await clean();
    const calls: Array<() => Promise<unknown>> = [
      () => actions.previewCustomerImportAction({ records: fixtureRecords() }),
      () => actions.commitCustomerImportAction({ records: fixtureRecords() }),
      () => actions.listCustomersWithoutPinAction(),
      () => actions.geocodeCustomersAction(["x"]),
      () =>
        actions.confirmCustomerPinAction({
          id: "x",
          lat: 48,
          lng: 16,
          baseUpdatedAt: new Date().toISOString(),
        }),
      () => queries.pinReviewQueueQuery(),
      () => queries.pinReviewCountQuery(),
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
    expect(await t.prisma.customer.count()).toBe(0);
  });

  it("imports 147 of 150 rows, reports the 3 invalid ones, and a re-import updates instead of duplicating", async () => {
    await clean();
    const records = fixtureRecords();
    expect(records).toHaveLength(150);

    const preview = await actions.previewCustomerImportAction({ records });
    expect(preview).toMatchObject({
      ok: true,
      summary: { create: 147, update: 0, unchanged: 0, error: 3 },
    });
    expect(await t.prisma.customer.count()).toBe(0); // a preview writes nothing

    const first = await actions.commitCustomerImportAction({ records });
    expect(first).toMatchObject({
      ok: true,
      created: 147,
      updated: 0,
      unchanged: 0,
      withoutPin: 147,
    });
    if (!first.ok) throw new Error("unreachable");
    expect(first.failed.map((f) => [f.line, f.issues[0]!.code, f.issues[0]!.field])).toEqual([
      [21, "required", "postalCode"],
      [78, "formula", "name"],
      [121, "bad_country", "country"],
    ]);
    expect(await t.prisma.customer.count()).toBe(147);
    expect(await t.prisma.customer.count({ where: { pinConfirmed: true } })).toBe(0);
    expect(await t.prisma.customer.count({ where: { lat: { not: null } } })).toBe(0);

    // Leading zero, umlauts, Chinese, the search trigger filled `searchText` for the import too.
    const dresden = await t.prisma.customer.findFirstOrThrow({ where: { city: "Dresden" } });
    expect(dresden).toMatchObject({ postalCode: "01067", country: "DE" });
    const chinese = await t.prisma.customer.findFirstOrThrow({
      where: { name: { startsWith: "龙门饭店" } },
    });
    expect(chinese.searchText).toContain("龙门饭店");
    const loewen = await t.prisma.customer.findFirstOrThrow({
      where: { name: { contains: "Löwen" } },
    });
    expect(loewen.searchText).toContain("lowen");
    // Notes are stored German-only and wait for the translation retry job.
    const withNote = await t.prisma.customer.findFirstOrThrow({
      where: { customerNumber: "K-0001" },
    });
    expect(withNote.notes).toMatchObject({
      de: "Hintereingang im Hof benutzen",
      meta: { source: "de", pendingTranslation: true },
    });

    const second = await actions.commitCustomerImportAction({ records });
    expect(second).toMatchObject({ ok: true, created: 0, updated: 0, unchanged: 147 });
    expect(await t.prisma.customer.count()).toBe(147);
  });

  it("updates changed rows, keeps confirmed pins unless the address changed, matches numbers case-insensitively", async () => {
    await clean();
    const base = { postalCode: "1010", city: "Wien" };
    const mk = (n: string, over: Record<string, unknown> = {}) =>
      t.prisma.customer.create({
        data: {
          customerNumber: n,
          name: `Kunde ${n}`,
          street: "Altstraße 1",
          country: "AT",
          lat: 48.2,
          lng: 16.3,
          pinConfirmed: true,
          ...base,
          ...over,
        },
      });
    await mk("U-1");
    await mk("U-2");
    await mk("U-3");
    await mk("U-4", { active: false });
    const rec = (n: string, line: number, over: Record<string, string> = {}) => ({
      line,
      values: {
        customerNumber: n,
        name: `Kunde ${n}`,
        street: "Altstraße 1",
        postalCode: "1010",
        city: "Wien",
        ...over,
      },
    });
    const result = await commitImport(t.prisma, {
      records: [
        rec("u-1", 2, { name: "Neuer Name" }), // name only: pin stays confirmed
        rec("U-2", 3, { street: "Neugasse 7" }), // address: pin dropped
        rec("U-3", 4), // unchanged
        rec("U-4", 5, { city: "Graz" }), // archived: updated, stays archived
        rec("U-5", 6), // new
      ],
    });
    expect(result).toMatchObject({
      ok: true,
      created: 1,
      updated: 3,
      unchanged: 1,
      pinsReset: 2,
      archivedUpdated: 1,
    });
    const rows = Object.fromEntries(
      (await t.prisma.customer.findMany()).map((c) => [c.customerNumber, c]),
    );
    expect(rows["U-1"]).toMatchObject({ name: "Neuer Name", pinConfirmed: true, lat: 48.2 });
    expect(rows["U-2"]).toMatchObject({
      street: "Neugasse 7",
      pinConfirmed: false,
      lat: null,
      lng: null,
    });
    expect(rows["U-3"]).toMatchObject({ pinConfirmed: true, lat: 48.2 });
    expect(rows["U-4"]).toMatchObject({
      city: "Graz",
      active: false,
      pinConfirmed: false,
      lat: null,
    });
    expect(rows["U-5"]).toMatchObject({ pinConfirmed: false, lat: null, active: true });
    expect(await t.prisma.customer.count()).toBe(5); // no u-1 duplicate
  });

  it("reports an update when the customer was edited after the import started", async () => {
    await clean();
    await t.prisma.customer.create({
      data: {
        customerNumber: "R-1",
        name: "Alt",
        street: "A 1",
        postalCode: "1010",
        city: "Wien",
        country: "AT",
      },
    });
    const customer = t.prisma.customer;
    const racing = {
      customer: {
        findMany: customer.findMany.bind(customer),
        count: customer.count.bind(customer),
        create: customer.create.bind(customer),
        updateMany: async (args: Parameters<typeof customer.updateMany>[0]) => {
          // Somebody saves the customer between the import's read and its write.
          await customer.updateMany({ where: { customerNumber: "R-1" }, data: { name: "Büro" } });
          return customer.updateMany(args);
        },
      },
    } as unknown as Parameters<typeof commitImport>[0];
    const result = await commitImport(racing, {
      records: [
        {
          line: 2,
          values: {
            customerNumber: "R-1",
            name: "Import",
            street: "A 1",
            postalCode: "1010",
            city: "Wien",
          },
        },
      ],
    });
    expect(result).toMatchObject({ ok: true, updated: 0 });
    if (!result.ok) throw new Error("unreachable");
    expect(result.failed).toEqual([
      { line: 2, customerNumber: "R-1", name: "Import", issues: [{ code: "changed_meanwhile" }] },
    ]);
    expect((await customer.findFirstOrThrow({ where: { customerNumber: "R-1" } })).name).toBe(
      "Büro",
    );
  });

  it("re-validates what the browser sends", async () => {
    await clean();
    const bad = [
      {},
      { records: [] },
      { records: [{ line: 0, values: {} }] },
      { records: [{ line: 2, values: { name: 5 } }] },
      { records: [{ line: 2, values: { bogus: "x" } }] },
      { records: [{ line: 2, values: { name: "x".repeat(2001) } }] },
      {
        records: Array.from({ length: 2001 }, (_, i) => ({ line: i + 1, values: { name: "x" } })),
      },
    ];
    for (const input of bad) {
      expect(await commitImport(t.prisma, input)).toEqual({ ok: false, error: "invalid" });
      expect(await previewImport(t.prisma, input)).toEqual({ ok: false, error: "invalid" });
    }
    // Rows the file reader would have rejected are rejected here too.
    const result = await commitImport(t.prisma, {
      records: [
        {
          line: 2,
          values: {
            customerNumber: "=cmd|' /C calc'!A0",
            name: "X",
            street: "S 1",
            postalCode: "1010",
            city: "Wien",
          },
        },
        {
          line: 3,
          values: {
            customerNumber: "OK-1",
            name: "X",
            street: "S 1",
            postalCode: "1010",
            city: "Wien",
          },
        },
      ],
    });
    expect(result).toMatchObject({ ok: true, created: 1 });
    expect(await t.prisma.customer.count()).toBe(1);
  });

  describe("batch geocoding and pin review", () => {
    const seed = async (n: number) => {
      await clean();
      await t.prisma.customer.createMany({
        data: Array.from({ length: n }, (_, i) => ({
          customerNumber: `G-${String(i + 1).padStart(3, "0")}`,
          name: `Geo ${i + 1}`,
          street: `Teststraße ${i + 1}`,
          postalCode: "1010",
          city: "Wien",
          country: "AT",
        })),
      });
      return listCustomerIdsWithoutPin(t.prisma);
    };

    it("stores candidates as unconfirmed pins, at most 5 per batch, only for customers without a pin", async () => {
      const ids = await seed(8);
      expect(ids).toHaveLength(8);
      const waits = vi.fn(noWait);
      const first = await geocodeCustomers(t.prisma, new FakeGeocoder(), ids.slice(0, 5), {
        wait: waits,
      });
      expect(first).toMatchObject({ ok: true, stopped: null });
      if (!first.ok) throw new Error("unreachable");
      expect(first.outcomes.map((o) => o.status)).toEqual(Array(5).fill("found"));
      expect(first.outcomes.every((o) => o.lowConfidence)).toBe(true); // the Fake is always unsure
      expect(waits).toHaveBeenCalledTimes(5);
      expect(await geocodeCustomers(t.prisma, new FakeGeocoder(), ids, { wait: noWait })).toEqual({
        ok: false,
        error: "invalid",
      });
      expect(await geocodeCustomers(t.prisma, new FakeGeocoder(), [], { wait: noWait })).toEqual({
        ok: false,
        error: "invalid",
      });
      const rows = await t.prisma.customer.findMany({ where: { lat: { not: null } } });
      expect(rows).toHaveLength(5);
      expect(rows.every((r) => r.pinConfirmed === false)).toBe(true);
      // Already geocoded customers are skipped, nothing is overwritten.
      const again = await geocodeCustomers(t.prisma, new FakeGeocoder(), ids.slice(3, 8), {
        wait: noWait,
      });
      if (!again.ok) throw new Error("unreachable");
      expect(again.outcomes.map((o) => o.status)).toEqual([
        "skipped",
        "skipped",
        "found",
        "found",
        "found",
      ]);
      expect(await listCustomerIdsWithoutPin(t.prisma)).toEqual([]);
    });

    it("does not touch confirmed or archived customers", async () => {
      const ids = await seed(3);
      await t.prisma.customer.update({
        where: { id: ids[0]! },
        data: { lat: 1, lng: 2, pinConfirmed: true },
      });
      await t.prisma.customer.update({ where: { id: ids[1]! }, data: { active: false } });
      const r = await geocodeCustomers(t.prisma, new FakeGeocoder(), ids, { wait: noWait });
      if (!r.ok) throw new Error("unreachable");
      expect(r.outcomes.map((o) => o.status)).toEqual(["skipped", "skipped", "found"]);
      expect((await t.prisma.customer.findUniqueOrThrow({ where: { id: ids[0]! } })).lat).toBe(1);
    });

    it("stops at a rate-limit answer and after three failures in a row, and tells which", async () => {
      const ids = await seed(5);
      const limited: Geocoder = {
        search: vi
          .fn()
          .mockResolvedValueOnce([{ label: "x", lat: 48, lng: 16, confidence: 0.9 }])
          .mockRejectedValue(new GeocoderError("slow down", "HTTP", 429)),
        reverse: async () => null,
      };
      const a = await geocodeCustomers(t.prisma, limited, ids, { wait: noWait });
      expect(a).toMatchObject({ ok: true, stopped: "rate_limited" });
      if (!a.ok) throw new Error("unreachable");
      expect(a.outcomes).toEqual([{ id: ids[0], status: "found", lowConfidence: false }]);
      expect(limited.search).toHaveBeenCalledTimes(2);

      const down: Geocoder = {
        search: vi.fn().mockRejectedValue(new GeocoderError("down", "NETWORK")),
        reverse: async () => null,
      };
      const rest = await listCustomerIdsWithoutPin(t.prisma);
      const b = await geocodeCustomers(t.prisma, down, rest, { wait: noWait });
      expect(b).toMatchObject({ ok: true, stopped: "unavailable" });
      expect(down.search).toHaveBeenCalledTimes(3);

      const empty: Geocoder = { search: async () => [], reverse: async () => null };
      const c = await geocodeCustomers(t.prisma, empty, rest.slice(0, 1), { wait: noWait });
      if (!c.ok) throw new Error("unreachable");
      expect(c.outcomes[0]!.status).toBe("not_found");
      expect(
        (await t.prisma.customer.findUniqueOrThrow({ where: { id: rest[0]! } })).lat,
      ).toBeNull();
    });

    it("pin review: queue holds unconfirmed active customers; confirming stores the dragged pin", async () => {
      const ids = await seed(3);
      await t.prisma.customer.update({ where: { id: ids[2]! }, data: { active: false } });
      const queue = await listPinReviewQueue(t.prisma);
      expect(queue.map((q) => q.customerNumber)).toEqual(["G-001", "G-002"]);

      const item = queue[0]!;
      const ok = await confirmPin(t.prisma, {
        id: item.id,
        lat: 48.2082123456,
        lng: 16.37381,
        baseUpdatedAt: item.updatedAt,
      });
      expect(ok).toEqual({ ok: true });
      expect(await t.prisma.customer.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({
        lat: 48.208212,
        lng: 16.37381,
        pinConfirmed: true,
      });
      expect((await listPinReviewQueue(t.prisma)).map((q) => q.customerNumber)).toEqual(["G-002"]);

      // Edited since the queue was loaded -> refused, nothing stored.
      const other = queue[1]!;
      await t.prisma.customer.update({
        where: { id: other.id },
        data: { street: "Andere Gasse 1" },
      });
      expect(
        await confirmPin(t.prisma, {
          id: other.id,
          lat: 48,
          lng: 16,
          baseUpdatedAt: other.updatedAt,
        }),
      ).toEqual({ ok: false, error: "conflict" });
      expect(
        (await t.prisma.customer.findUniqueOrThrow({ where: { id: other.id } })).pinConfirmed,
      ).toBe(false);
      expect(
        await confirmPin(t.prisma, {
          id: "nope",
          lat: 48,
          lng: 16,
          baseUpdatedAt: other.updatedAt,
        }),
      ).toEqual({ ok: false, error: "not_found" });
      for (const bad of [
        { id: other.id, lat: 91, lng: 16, baseUpdatedAt: other.updatedAt },
        { id: other.id, lat: 48, lng: 181, baseUpdatedAt: other.updatedAt },
        { id: other.id, lat: 48, lng: 16, baseUpdatedAt: "yesterday" },
        { id: other.id, lat: "48", lng: 16, baseUpdatedAt: other.updatedAt },
        {},
      ]) {
        expect(await confirmPin(t.prisma, bad)).toEqual({ ok: false, error: "invalid" });
      }
    });
  });
});
