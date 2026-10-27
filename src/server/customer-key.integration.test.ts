// @vitest-environment node
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { SyncEntry } from "@/domain/driver-sync";

import { hashSecret } from "./auth/password";
import { createTestDb, type TestDb } from "./test-db";

const state: { session: { user?: { id: string } } | null; db: TestDb["prisma"] | null } = {
  session: null,
  db: null,
};
vi.mock("next/cache", () => ({
  updateTag: vi.fn(),
  cacheTag: vi.fn(),
  cacheLife: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("./auth/auth", () => ({ auth: async () => state.session }));
vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  getDb: () => state.db,
}));

const { applySyncBatch, driverSyncResponse } = await import("./driver-sync");
const { applyDriverKey, getCustomerKeyHistory, setCustomerKey } = await import("./customer-key");
const { createCustomerAction, updateCustomerAction } = await import("./customer-actions");
const { customerKeyHistoryQuery, getCustomerQuery } = await import("./customer-queries");
const { getDriverTourResponse } = await import("./driver-tour-payload");

const T0 = new Date("2099-07-02T08:00:00.000Z");
const SERVER_NOW = new Date("2099-07-02T10:00:00.000Z");

describe.skipIf(!process.env.DATABASE_URL)("customer key (NUD-142)", { timeout: 60_000 }, () => {
  let t: TestDb;
  let adminId: string;
  let driverId: string;
  let otherDriverId: string;
  let customerId: string;
  let foreignCustomerId: string;
  let stopId: string;
  let foreignStopId: string;
  let tourId: string;

  const driver = (id = driverId) => ({ id, role: "DRIVER" as const, locale: "de" });
  const keyEntry = (extra: Partial<SyncEntry> = {}, at = T0): SyncEntry => ({
    clientMutationId: randomUUID(),
    type: "key",
    stopId,
    hasKey: true,
    keyNumber: "17",
    createdAt: at.toISOString(),
    ...extra,
  });
  const sync = (entries: SyncEntry[], who = driver()) =>
    applySyncBatch(t.prisma, who, entries, SERVER_NOW, { afterApply: () => undefined });
  const customer = () => t.prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
  // The audit log is append-only: every test looks only at the entries written since it started.
  let since = new Date();
  const audits = () =>
    t.prisma.auditLog.findMany({
      where: {
        entity: "Customer",
        entityId: customerId,
        action: "customer.key",
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "asc" },
    });

  beforeAll(async () => {
    t = await createTestDb();
    state.db = t.prisma;
    const hash = await hashSecret("123456");
    const user = (data: Record<string, unknown>) =>
      t.prisma.user.create({ data: { passwordHash: hash, ...data } as never }).then((u) => u.id);
    adminId = await user({ role: "ADMIN", email: "a@example.com", displayName: "Büro Anna" });
    driverId = await user({ role: "DRIVER", username: "drv", displayName: "Fahrer Marko" });
    otherDriverId = await user({ role: "DRIVER", username: "drv2", displayName: "Other" });
    const mkCustomer = (n: number) =>
      t.prisma.customer
        .create({
          data: {
            customerNumber: `K${n}`,
            name: `Trattoria ${n}`,
            street: "Hauptstraße 1",
            postalCode: "1010",
            city: "Wien",
            lat: 48.2,
            lng: 16.3,
          },
        })
        .then((c) => c.id);
    customerId = await mkCustomer(1);
    foreignCustomerId = await mkCustomer(2);
    const depot = { name: "Depot", address: "x", lat: 48.2, lng: 16.3 };
    const mkTour = (day: number, who: string) =>
      t.prisma.tour.create({
        data: {
          date: new Date(`2099-07-0${day}T00:00:00Z`),
          driverId: who,
          status: "RELEASED",
          releaseRevision: 1,
          depotSnapshot: depot,
        },
      });
    const tour = await mkTour(2, driverId);
    tourId = tour.id;
    stopId = (await t.prisma.stop.create({ data: { tourId, customerId, sequence: 1, items: [] } }))
      .id;
    const foreignTour = await mkTour(3, otherDriverId);
    foreignStopId = (
      await t.prisma.stop.create({
        data: { tourId: foreignTour.id, customerId: foreignCustomerId, sequence: 1, items: [] },
      })
    ).id;
  });

  beforeEach(async () => {
    since = new Date();
    state.session = null;
    await t.prisma.stopMutation.deleteMany();
    await t.prisma.customer.updateMany({
      data: { hasKey: null, keyNumber: null, keyUpdatedById: null, keyUpdatedAt: null },
    });
  });

  afterAll(async () => {
    await t?.teardown();
  });

  it("a driver sets a missing key: the customer shows who and when, the audit entry has the diff", async () => {
    const res = await sync([keyEntry()]);
    expect(res.results[0]).toMatchObject({ outcome: "applied" });
    const row = await customer();
    expect(row).toMatchObject({ hasKey: true, keyNumber: "17", keyUpdatedById: driverId });
    // The tap time (clamped) is the time of the change, not the time the request arrived.
    expect(row.keyUpdatedAt?.toISOString()).toBe(T0.toISOString());
    const [entry] = await audits();
    expect(entry).toMatchObject({ actorId: driverId });
    expect(entry!.diff).toMatchObject({
      hasKey: { from: null, to: true },
      keyNumber: { from: null, to: "17" },
      via: "sync",
    });
    // The answer carries the authoritative key for the offline copy.
    expect(res.tours[0]!.stops[0]).toMatchObject({ hasKey: true, keyNumber: "17" });
    state.session = { user: { id: adminId } };
    const detail = await getCustomerQuery(customerId);
    expect(detail).toMatchObject({
      hasKey: true,
      keyNumber: "17",
      keyUpdatedBy: { name: "Fahrer Marko", role: "DRIVER" },
    });
  });

  it("a correction keeps the old value in the history", async () => {
    await sync([keyEntry({ keyNumber: "17" }, T0)]);
    await sync([keyEntry({ keyNumber: "71" }, new Date(T0.getTime() + 60_000))]);
    expect(await customer()).toMatchObject({ hasKey: true, keyNumber: "71" });
    state.session = { user: { id: adminId } };
    const history = await customerKeyHistoryQuery(customerId);
    // Earlier tests left entries behind (the log is append-only): look at the newest two.
    expect(history.length).toBeGreaterThanOrEqual(2);
    expect(history[0]).toMatchObject({
      from: { hasKey: true, keyNumber: "17" },
      to: { hasKey: true, keyNumber: "71" },
      via: "sync",
      actor: { name: "Fahrer Marko", role: "DRIVER" },
    });
    expect(history[1]).toMatchObject({ from: { hasKey: null }, to: { keyNumber: "17" } });
  });

  it("'no key' clears the number; an unchanged value writes nothing", async () => {
    await sync([keyEntry()]);
    await sync([keyEntry({ hasKey: false, keyNumber: undefined })]);
    expect(await customer()).toMatchObject({ hasKey: false, keyNumber: null });
    await sync([keyEntry({ hasKey: false })]);
    expect(await audits()).toHaveLength(2);
  });

  it("is idempotent by clientMutationId and survives a replay after a later change", async () => {
    const first = keyEntry({ keyNumber: "5" });
    expect((await sync([first])).results[0]!.outcome).toBe("applied");
    await t.prisma.customer.update({ where: { id: customerId }, data: { keyNumber: "99" } });
    expect((await sync([first])).results[0]!.outcome).toBe("replayed");
    expect((await customer()).keyNumber).toBe("99");
    expect(await audits()).toHaveLength(1);
  });

  it("rejects a stop of another driver and an unknown stop as not_found", async () => {
    const res = await sync([keyEntry({ stopId: foreignStopId }), keyEntry({ stopId: "nope" })]);
    expect(res.results.map((r) => [r.outcome, r.error])).toEqual([
      ["rejected", "not_found"],
      ["rejected", "not_found"],
    ]);
    expect(
      (await t.prisma.customer.findUniqueOrThrow({ where: { id: foreignCustomerId } })).hasKey,
    ).toBeNull();
  });

  it("rejects a too long number, a non-driver and reuse of an id for another stop", async () => {
    // `applyDriverKey` takes the entry without the client time (the sync batch passes it separately).
    const raw = (extra: Partial<SyncEntry> = {}) => {
      const { createdAt, ...rest } = keyEntry(extra);
      void createdAt;
      return rest;
    };
    expect((await applyDriverKey(t.prisma, driver(), raw({ keyNumber: "x".repeat(21) }))).ok).toBe(
      false,
    );
    expect(await applyDriverKey(t.prisma, { id: adminId, role: "ADMIN" }, raw())).toEqual({
      ok: false,
      error: "forbidden",
    });
    const id = randomUUID();
    await sync([keyEntry({ clientMutationId: id })]);
    const other = await applyDriverKey(
      t.prisma,
      driver(otherDriverId),
      raw({ clientMutationId: id, stopId: foreignStopId }),
    );
    expect(other).toEqual({ ok: false, error: "mutation_conflict" });
  });

  it("the HTTP endpoint rejects a key number over the limit and other roles", async () => {
    const post = (body: unknown) =>
      driverSyncResponse(
        new Request("http://localhost/api/driver/sync", {
          method: "POST",
          headers: { "content-type": "application/json", origin: "http://localhost" },
          body: JSON.stringify(body),
        }),
        SERVER_NOW,
      );
    state.session = { user: { id: driverId } };
    expect((await post({ entries: [keyEntry({ keyNumber: "y".repeat(21) })] })).status).toBe(400);
    expect((await post({ entries: [keyEntry()] })).status).toBe(200);
    expect((await customer()).keyNumber).toBe("17");
    state.session = { user: { id: adminId } };
    expect((await post({ entries: [keyEntry()] })).status).toBe(403);
  });

  it("the office sets the key on the form; an unchanged form does not touch it", async () => {
    state.session = { user: { id: adminId } };
    const form = {
      customerNumber: "K1",
      name: "Trattoria 1",
      street: "Hauptstraße 1",
      postalCode: "1010",
      city: "Wien",
      country: "AT",
      lat: 48.2,
      lng: 16.3,
    };
    expect(
      await updateCustomerAction(customerId, { ...form, hasKey: true, keyNumber: " B-4 " }),
    ).toEqual({
      ok: true,
      id: customerId,
    });
    expect(await customer()).toMatchObject({
      hasKey: true,
      keyNumber: "B-4",
      keyUpdatedById: adminId,
    });
    // A driver corrects it; a form saved without key fields must not overwrite that.
    await sync([keyEntry({ keyNumber: "C-9" }, new Date(T0.getTime() + 1000))]);
    await updateCustomerAction(customerId, form);
    expect((await customer()).keyNumber).toBe("C-9");
    // The office resets to unknown.
    await updateCustomerAction(customerId, { ...form, hasKey: null, keyNumber: "" });
    expect(await customer()).toMatchObject({ hasKey: null, keyNumber: null });
    const entries = await audits();
    expect(entries.map((e) => (e.diff as { via: string }).via)).toEqual([
      "office",
      "sync",
      "office",
    ]);
    // A new customer can be created with a key.
    const created = await createCustomerAction({
      ...form,
      customerNumber: "K9",
      hasKey: true,
      keyNumber: "1",
    });
    expect(created.ok).toBe(true);
    if (created.ok) {
      expect(
        await t.prisma.customer.findUniqueOrThrow({ where: { id: created.id } }),
      ).toMatchObject({ hasKey: true, keyNumber: "1", keyUpdatedById: adminId });
    }
  });

  it("setCustomerKey validates input and reports unknown customers", async () => {
    const base = { actorId: adminId, via: "office" as const };
    expect(await setCustomerKey(t.prisma, { ...base, customerId: "nope", hasKey: true })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(
      await setCustomerKey(t.prisma, {
        ...base,
        customerId,
        hasKey: true,
        keyNumber: "z".repeat(21),
      }),
    ).toEqual({ ok: false, error: "invalid" });
    expect(await getCustomerKeyHistory(t.prisma, 42)).toEqual([]);
  });

  it("the cached driver tour payload carries hasKey and keyNumber", async () => {
    await sync([keyEntry({ keyNumber: "8" })]);
    const response = await getDriverTourResponse(
      t.prisma,
      { id: driverId, role: "DRIVER" },
      {
        now: new Date("2099-07-02T06:00:00.000Z"),
        timezone: "Europe/Vienna",
        serviceMinutesPerStop: 10,
      },
    );
    expect(response.tour?.stops[0]).toMatchObject({ hasKey: true, keyNumber: "8" });
    expect(tourId).toBeTruthy();
  });
});
