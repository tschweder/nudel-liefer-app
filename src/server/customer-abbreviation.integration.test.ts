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
const { applyDriverAbbreviation, getCustomerAbbreviationHistory, setCustomerAbbreviation } =
  await import("./customer-abbreviation");
const { updateCustomerAction } = await import("./customer-actions");
const { customerAbbreviationHistoryQuery, getCustomerQuery } = await import("./customer-queries");
const { getDriverTourResponse } = await import("./driver-tour-payload");

const T0 = new Date("2099-08-02T08:00:00.000Z");
const SERVER_NOW = new Date("2099-08-02T10:00:00.000Z");

describe.skipIf(!process.env.DATABASE_URL)(
  "customer Abkürzung (NUD-164)",
  { timeout: 60_000 },
  () => {
    let t: TestDb;
    let adminId: string;
    let driverId: string;
    let otherDriverId: string;
    let customerId: string;
    let sameAbbreviationCustomerId: string;
    let foreignCustomerId: string;
    let stopId: string;
    let foreignStopId: string;

    const driver = (id = driverId) => ({ id, role: "DRIVER" as const, locale: "de" });
    const entry = (extra: Partial<SyncEntry> = {}, at = T0): SyncEntry => ({
      clientMutationId: randomUUID(),
      type: "abbreviation",
      stopId,
      abbreviation: "Ä/ß-#1",
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
          action: "customer.abbreviation",
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
      sameAbbreviationCustomerId = await mkCustomer(3);
      const depot = { name: "Depot", address: "x", lat: 48.2, lng: 16.3 };
      const mkTour = (day: number, who: string) =>
        t.prisma.tour.create({
          data: {
            date: new Date(`2099-08-0${day}T00:00:00Z`),
            driverId: who,
            status: "RELEASED",
            releaseRevision: 1,
            depotSnapshot: depot,
          },
        });
      const tour = await mkTour(2, driverId);
      stopId = (
        await t.prisma.stop.create({
          data: { tourId: tour.id, customerId, sequence: 1, items: [] },
        })
      ).id;
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
        data: { abbreviation: null, abbreviationUpdatedById: null, abbreviationUpdatedAt: null },
      });
    });

    afterAll(async () => {
      await t?.teardown();
    });

    it("a driver sets an Abkürzung with special characters: who and when are recorded, the audit entry has the diff", async () => {
      const res = await sync([entry()]);
      expect(res.results[0]).toMatchObject({ outcome: "applied" });
      const row = await customer();
      expect(row).toMatchObject({ abbreviation: "Ä/ß-#1", abbreviationUpdatedById: driverId });
      expect(row.abbreviationUpdatedAt?.toISOString()).toBe(T0.toISOString());
      const [audit] = await audits();
      expect(audit).toMatchObject({ actorId: driverId });
      expect(audit!.diff).toMatchObject({
        abbreviation: { from: null, to: "Ä/ß-#1" },
        via: "sync",
      });
      // The answer carries the authoritative value for the offline copy.
      expect(res.tours[0]!.stops[0]).toMatchObject({ abbreviation: "Ä/ß-#1" });
      state.session = { user: { id: adminId } };
      expect(await getCustomerQuery(customerId)).toMatchObject({
        abbreviation: "Ä/ß-#1",
        abbreviationUpdatedBy: { name: "Fahrer Marko", role: "DRIVER" },
      });
    });

    it("a correction keeps the old value in the history; blank clears it; unchanged writes nothing", async () => {
      await sync([entry({ abbreviation: "A1" }, T0)]);
      await sync([entry({ abbreviation: "B2" }, new Date(T0.getTime() + 60_000))]);
      await sync([entry({ abbreviation: undefined }, new Date(T0.getTime() + 120_000))]);
      await sync([entry({ abbreviation: undefined }, new Date(T0.getTime() + 180_000))]);
      expect(await customer()).toMatchObject({ abbreviation: null });
      expect(await audits()).toHaveLength(3);
      state.session = { user: { id: adminId } };
      const history = await customerAbbreviationHistoryQuery(customerId);
      expect(history[0]).toMatchObject({ from: "B2", to: null, via: "sync" });
      expect(history[1]).toMatchObject({
        from: "A1",
        to: "B2",
        actor: { name: "Fahrer Marko", role: "DRIVER" },
      });
    });

    it("is not unique: two customers may hold the same Abkürzung", async () => {
      await sync([entry({ abbreviation: "SAME" })]);
      expect(
        await setCustomerAbbreviation(t.prisma, {
          actorId: adminId,
          customerId: sameAbbreviationCustomerId,
          abbreviation: "SAME",
          via: "office",
        }),
      ).toMatchObject({ ok: true, changed: true });
      expect((await customer()).abbreviation).toBe("SAME");
    });

    it("is idempotent by clientMutationId", async () => {
      const first = entry({ abbreviation: "X" });
      expect((await sync([first])).results[0]!.outcome).toBe("applied");
      await t.prisma.customer.update({ where: { id: customerId }, data: { abbreviation: "Y" } });
      expect((await sync([first])).results[0]!.outcome).toBe("replayed");
      expect((await customer()).abbreviation).toBe("Y");
      expect(await audits()).toHaveLength(1);
    });

    it("rejects a stop of another driver and an unknown stop as not_found", async () => {
      const res = await sync([entry({ stopId: foreignStopId }), entry({ stopId: "nope" })]);
      expect(res.results.map((r) => [r.outcome, r.error])).toEqual([
        ["rejected", "not_found"],
        ["rejected", "not_found"],
      ]);
      expect(
        (await t.prisma.customer.findUniqueOrThrow({ where: { id: foreignCustomerId } }))
          .abbreviation,
      ).toBeNull();
    });

    it("rejects a too long text, a non-driver and reuse of an id for another stop", async () => {
      const raw = (extra: Partial<SyncEntry> = {}) => {
        const { createdAt, ...rest } = entry(extra);
        void createdAt;
        return rest;
      };
      expect(
        (await applyDriverAbbreviation(t.prisma, driver(), raw({ abbreviation: "x".repeat(21) })))
          .ok,
      ).toBe(false);
      expect(
        await applyDriverAbbreviation(t.prisma, { id: adminId, role: "ADMIN" }, raw()),
      ).toEqual({ ok: false, error: "forbidden" });
      const id = randomUUID();
      await sync([entry({ clientMutationId: id })]);
      expect(
        await applyDriverAbbreviation(
          t.prisma,
          driver(otherDriverId),
          raw({ clientMutationId: id, stopId: foreignStopId }),
        ),
      ).toEqual({ ok: false, error: "mutation_conflict" });
    });

    it("the HTTP endpoint rejects a text over the limit and other roles", async () => {
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
      expect((await post({ entries: [entry({ abbreviation: "y".repeat(21) })] })).status).toBe(400);
      expect((await post({ entries: [entry()] })).status).toBe(200);
      expect((await customer()).abbreviation).toBe("Ä/ß-#1");
      state.session = { user: { id: adminId } };
      expect((await post({ entries: [entry()] })).status).toBe(403);
    });

    it("the office edits it on the form; an unchanged form does not touch it", async () => {
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
      expect(await updateCustomerAction(customerId, { ...form, abbreviation: " B-4 " })).toEqual({
        ok: true,
        id: customerId,
      });
      expect(await customer()).toMatchObject({
        abbreviation: "B-4",
        abbreviationUpdatedById: adminId,
      });
      // A driver corrects it; a form saved without the field must not overwrite that.
      await sync([entry({ abbreviation: "C-9" }, new Date(T0.getTime() + 1000))]);
      await updateCustomerAction(customerId, form);
      expect((await customer()).abbreviation).toBe("C-9");
      await updateCustomerAction(customerId, { ...form, abbreviation: "" });
      expect((await customer()).abbreviation).toBeNull();
      expect((await audits()).map((e) => (e.diff as { via: string }).via)).toEqual([
        "office",
        "sync",
        "office",
      ]);
    });

    it("setCustomerAbbreviation validates input and reports unknown customers", async () => {
      const base = { actorId: adminId, via: "office" as const };
      expect(
        await setCustomerAbbreviation(t.prisma, { ...base, customerId: "nope", abbreviation: "A" }),
      ).toEqual({ ok: false, error: "not_found" });
      expect(
        await setCustomerAbbreviation(t.prisma, {
          ...base,
          customerId,
          abbreviation: "z".repeat(21),
        }),
      ).toEqual({ ok: false, error: "invalid" });
      expect(await getCustomerAbbreviationHistory(t.prisma, 42)).toEqual([]);
    });

    it("the cached driver tour payload carries the Abkürzung", async () => {
      await sync([entry({ abbreviation: "P-8" })]);
      const response = await getDriverTourResponse(
        t.prisma,
        { id: driverId, role: "DRIVER" },
        {
          now: new Date("2099-08-02T06:00:00.000Z"),
          timezone: "Europe/Vienna",
          serviceMinutesPerStop: 10,
        },
      );
      expect(response.tour?.stops[0]).toMatchObject({ abbreviation: "P-8" });
    });
  },
);
