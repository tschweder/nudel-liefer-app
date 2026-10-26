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
const { scheduleProblemNoteTranslation } = await import("./problem-note-translation");

const T0 = new Date("2099-07-02T08:00:00.000Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000).toISOString();
const SERVER_NOW = new Date("2099-07-02T10:00:00.000Z");

describe.skipIf(!process.env.DATABASE_URL)("driver offline sync", { timeout: 60_000 }, () => {
  let t: TestDb;
  let driverId: string;
  let otherDriverId: string;
  let adminId: string;
  let customerIds: string[];
  let tourId: string;
  let stopIds: string[];
  let foreignStopId: string;

  const actor = (id = driverId, locale = "de") => ({ id, role: "DRIVER" as const, locale });
  const entry = (
    type: SyncEntry["type"],
    stop: number,
    createdAt: string,
    extra: Partial<SyncEntry> = {},
  ): SyncEntry => ({
    clientMutationId: randomUUID(),
    type,
    stopId: stopIds[stop]!,
    createdAt,
    ...extra,
  });
  const sync = (entries: SyncEntry[], who = actor(), now = SERVER_NOW, deps = {}) =>
    applySyncBatch(t.prisma, who, entries, now, { afterApply: () => undefined, ...deps });
  const stopRow = (i: number) => t.prisma.stop.findUniqueOrThrow({ where: { id: stopIds[i] } });
  const tourRow = () => t.prisma.tour.findUniqueOrThrow({ where: { id: tourId } });

  async function reset() {
    await t.prisma.stopMutation.deleteMany();
    await t.prisma.stop.updateMany({
      where: { tourId },
      data: {
        status: "PENDING",
        problemReason: null,
        problemNote: undefined,
        completedAt: null,
        clientMutationId: null,
        adminChangedAt: null,
      },
    });
    await t.prisma.tour.update({
      where: { id: tourId },
      data: { status: "RELEASED", completedAt: null },
    });
  }

  beforeAll(async () => {
    t = await createTestDb();
    state.db = t.prisma;
    const hash = await hashSecret("123456");
    const user = (data: Record<string, unknown>) =>
      t.prisma.user.create({ data: { passwordHash: hash, ...data } as never }).then((u) => u.id);
    adminId = await user({ role: "ADMIN", email: "a@example.com", displayName: "A" });
    driverId = await user({
      role: "DRIVER",
      username: "drv",
      displayName: "Driver",
      locale: "zh_Hans",
      localeChosen: true,
    });
    otherDriverId = await user({ role: "DRIVER", username: "drv2", displayName: "Other" });
    customerIds = [];
    for (const n of [1, 2, 3, 4]) {
      const c = await t.prisma.customer.create({
        data: {
          customerNumber: `K${n}`,
          name: `Trattoria ${n}`,
          street: "Hauptstraße 1",
          postalCode: "1010",
          city: "Wien",
          lat: 48.2,
          lng: 16.3,
          pinConfirmed: true,
        },
      });
      customerIds.push(c.id);
    }
    const depot = { name: "Depot", address: "x", lat: 48.2, lng: 16.3 };
    const tour = await t.prisma.tour.create({
      data: {
        date: new Date("2099-07-02T00:00:00Z"),
        driverId,
        status: "RELEASED",
        releaseRevision: 1,
        depotSnapshot: depot,
      },
    });
    tourId = tour.id;
    stopIds = [];
    for (const [i, customerId] of customerIds.slice(0, 3).entries()) {
      const s = await t.prisma.stop.create({
        data: { tourId, customerId, sequence: i + 1, items: [] },
      });
      stopIds.push(s.id);
    }
    const foreignTour = await t.prisma.tour.create({
      data: {
        date: new Date("2099-07-03T00:00:00Z"),
        driverId: otherDriverId,
        status: "RELEASED",
        releaseRevision: 1,
        depotSnapshot: depot,
      },
    });
    foreignStopId = (
      await t.prisma.stop.create({
        data: { tourId: foreignTour.id, customerId: customerIds[3]!, sequence: 1, items: [] },
      })
    ).id;
  });

  beforeEach(async () => {
    state.session = null;
    await reset();
  });

  afterAll(async () => {
    await t?.teardown();
  });

  it("applies three queued deliveries once, reports the authoritative states and completes the tour", async () => {
    const entries = [
      entry("delivered", 0, at(1)),
      entry("delivered", 1, at(2)),
      entry("delivered", 2, at(3)),
    ];
    const res = await sync(entries);
    expect(res.results.map((r) => r.outcome)).toEqual(["applied", "applied", "applied"]);
    expect(await t.prisma.stop.count({ where: { tourId, status: "DELIVERED" } })).toBe(3);
    expect(await t.prisma.stopMutation.count()).toBe(3);
    expect((await tourRow()).status).toBe("COMPLETED");
    expect(res.tours).toHaveLength(1);
    expect(res.tours[0]).toMatchObject({ tourId, status: "COMPLETED" });
    expect(res.tours[0]!.stops.map((s) => s.status)).toEqual([
      "DELIVERED",
      "DELIVERED",
      "DELIVERED",
    ]);
    // The time of the stop is the time of the tap, not of the delivery of the request.
    expect((await stopRow(0)).completedAt?.toISOString()).toBe(at(1));
    expect(res.tours[0]!.stops[2]!.completedAt).toBe(at(3));
  });

  it("is idempotent: the same batch again changes nothing and is reported as replayed", async () => {
    const entries = [
      entry("delivered", 0, at(1)),
      entry("problem", 1, at(2), { reason: "CLOSED" }),
    ];
    await sync(entries);
    const before = await stopRow(0);
    const again = await sync(entries, actor(), new Date(SERVER_NOW.getTime() + 3_600_000));
    expect(again.results.map((r) => r.outcome)).toEqual(["replayed", "replayed"]);
    expect(await t.prisma.stopMutation.count()).toBe(2);
    expect((await stopRow(0)).completedAt).toEqual(before.completedAt);
    expect(await t.prisma.stop.count({ where: { tourId, status: { not: "PENDING" } } })).toBe(2);
  });

  it("handles the same id twice in one request as one mutation", async () => {
    const e = entry("delivered", 0, at(1));
    const res = await sync([e, { ...e }]);
    expect(res.results).toHaveLength(2);
    expect(await t.prisma.stopMutation.count()).toBe(1);
  });

  it("applies entries in the order the driver tapped, whatever the order in the request", async () => {
    const delivered = entry("delivered", 0, at(1));
    const undo = entry("undo", 0, at(3));
    const res = await sync([undo, delivered]);
    expect(res.results.map((r) => r.outcome)).toEqual(["applied", "applied"]);
    expect((await stopRow(0)).status).toBe("PENDING");
  });

  it("counts the undo window from the tap, not from the arrival of the request", async () => {
    const d = entry("delivered", 0, at(0));
    await sync([d]);
    // Undone 4 minutes after the delivery on the phone, synced hours later: still inside the window.
    const ok = await sync([entry("undo", 0, at(4))], actor(), new Date("2099-07-02T20:00:00Z"));
    expect(ok.results[0]).toMatchObject({ outcome: "applied" });
    expect((await stopRow(0)).status).toBe("PENDING");

    await sync([entry("delivered", 0, at(10))]);
    const late = await sync([entry("undo", 0, at(16))]);
    expect(late.results[0]).toMatchObject({ outcome: "rejected", error: "undo_expired" });
    expect((await stopRow(0)).status).toBe("DELIVERED");
  });

  it("never trusts a tap from the future or from days ago", async () => {
    const future = entry("delivered", 0, "2099-07-02T12:00:00.000Z");
    const ancient = entry("delivered", 1, "2099-01-01T00:00:00.000Z");
    await sync([future, ancient]);
    expect((await stopRow(0)).completedAt?.toISOString()).toBe(SERVER_NOW.toISOString());
    expect((await stopRow(1)).completedAt?.toISOString()).toBe("2099-07-01T10:00:00.000Z");
  });

  describe("conflict rule: the office's change after the tap wins", () => {
    it("rejects a tap made before the office changed the stop; the stop stays as the office left it", async () => {
      await t.prisma.stop.update({
        where: { id: stopIds[0] },
        data: { adminChangedAt: new Date(at(5)) },
      });
      const res = await sync([entry("delivered", 0, at(3)), entry("delivered", 1, at(3))]);
      expect(res.results[0]).toMatchObject({ outcome: "rejected", error: "changed_by_office" });
      expect(res.results[1]).toMatchObject({ outcome: "applied" });
      expect((await stopRow(0)).status).toBe("PENDING");
      expect((await stopRow(1)).status).toBe("DELIVERED");
      // The answer carries the authoritative state of the rejected stop.
      expect(res.tours[0]!.stops[0]).toMatchObject({ id: stopIds[0], status: "PENDING" });
      // A rejected mutation is not recorded: nothing blocks a later, deliberate attempt.
      expect(await t.prisma.stopMutation.count()).toBe(1);
    });

    it("accepts a tap made after the office's change", async () => {
      await t.prisma.stop.update({
        where: { id: stopIds[0] },
        data: { adminChangedAt: new Date(at(5)) },
      });
      const res = await sync([entry("delivered", 0, at(6))]);
      expect(res.results[0]).toMatchObject({ outcome: "applied" });
    });

    it("rejects taps for a stop the office removed, the rest of the batch goes through", async () => {
      const removed = await t.prisma.stop.create({
        data: { tourId, customerId: customerIds[3]!, sequence: 9, items: [] },
      });
      const e = { ...entry("delivered", 0, at(1)), stopId: removed.id };
      await t.prisma.stop.delete({ where: { id: removed.id } });
      const res = await sync([e, entry("delivered", 1, at(2))]);
      expect(res.results.map((r) => r.outcome)).toEqual(["rejected", "applied"]);
      expect(res.results[0]!.error).toBe("not_found");
    });

    it("rejects taps once the tour is no longer active", async () => {
      await t.prisma.tour.update({ where: { id: tourId }, data: { status: "OPTIMIZED" } });
      const res = await sync([entry("delivered", 0, at(1))]);
      expect(res.results[0]).toMatchObject({ outcome: "rejected", error: "tour_not_active" });
      expect((await stopRow(0)).status).toBe("PENDING");
    });

    it("rejects a second completion of a stop that is already closed", async () => {
      await sync([entry("delivered", 0, at(1))]);
      const res = await sync([entry("problem", 0, at(2), { reason: "CLOSED" })]);
      expect(res.results[0]).toMatchObject({ outcome: "rejected", error: "already_completed" });
      expect((await stopRow(0)).status).toBe("DELIVERED");
    });
  });

  it("does not let a driver touch or learn about another driver's tour", async () => {
    const e = { ...entry("delivered", 0, at(1)), stopId: foreignStopId };
    const res = await sync([e]);
    expect(res.results[0]).toMatchObject({ outcome: "rejected", error: "not_found" });
    expect(res.tours).toEqual([]);
    expect((await t.prisma.stop.findUniqueOrThrow({ where: { id: foreignStopId } })).status).toBe(
      "PENDING",
    );
  });

  it("stores a problem note like the live action and schedules its translation once per applied entry", async () => {
    const spy = vi.fn();
    const afterApply = (
      db: TestDb["prisma"],
      result: Parameters<typeof scheduleProblemNoteTranslation>[1],
    ) => scheduleProblemNoteTranslation(db as never, result, spy);
    const e = entry("problem", 0, at(1), { reason: "NO_PARKING", note: "地下停车场" });
    const who = actor(driverId, "zh-Hans");
    await sync([e], who, SERVER_NOW, { afterApply });
    expect(spy).toHaveBeenCalledTimes(1);
    const row = await stopRow(0);
    expect(row.status).toBe("PROBLEM");
    expect(row.problemReason).toBe("NO_PARKING");
    expect(row.problemNote).toMatchObject({
      meta: { source: "zh-Hans", pendingTranslation: true },
    });
    // A replay of the same batch must not schedule it again.
    await sync([e], who, SERVER_NOW, { afterApply });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("marks entries retry when something unexpected fails, without touching the data", async () => {
    const broken = new Proxy(t.prisma, {
      get: (target, prop, receiver) =>
        prop === "$transaction"
          ? () => Promise.reject(new Error("boom"))
          : Reflect.get(target, prop, receiver),
    });
    const res = await applySyncBatch(
      broken as never,
      actor(),
      [entry("delivered", 0, at(1)), entry("delivered", 1, at(2))],
      SERVER_NOW,
      { afterApply: () => undefined },
    );
    expect(res.results.map((r) => r.outcome)).toEqual(["retry", "retry"]);
    expect(await t.prisma.stop.count({ where: { tourId, status: "DELIVERED" } })).toBe(0);
  });

  describe("POST /api/driver/sync", () => {
    const request = (
      body: unknown,
      headers: Record<string, string> = { "Content-Type": "application/json" },
    ) =>
      new Request("http://localhost/api/driver/sync", {
        method: "POST",
        headers,
        body: typeof body === "string" ? body : JSON.stringify(body),
      });
    const valid = () => ({ entries: [entry("delivered", 0, at(1))] });

    it("rejects anonymous users and admins and changes nothing", async () => {
      state.session = null;
      expect((await driverSyncResponse(request(valid()), SERVER_NOW)).status).toBe(401);
      state.session = { user: { id: adminId } };
      expect((await driverSyncResponse(request(valid()), SERVER_NOW)).status).toBe(403);
      expect((await stopRow(0)).status).toBe("PENDING");
      expect(await t.prisma.stopMutation.count()).toBe(0);
    });

    it("rejects a deactivated driver", async () => {
      await t.prisma.user.update({ where: { id: otherDriverId }, data: { active: false } });
      state.session = { user: { id: otherDriverId } };
      expect((await driverSyncResponse(request(valid()), SERVER_NOW)).status).toBe(401);
      await t.prisma.user.update({ where: { id: otherDriverId }, data: { active: true } });
    });

    it("answers a valid batch of the signed-in driver", async () => {
      state.session = { user: { id: driverId } };
      const res = await driverSyncResponse(request(valid()), SERVER_NOW);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toContain("no-store");
      const body = await res.json();
      expect(body.results).toHaveLength(1);
      expect(body.results[0].outcome).toBe("applied");
      expect(body.tours[0].stops).toHaveLength(3);
    });

    it.each([
      ["not JSON", () => "{nope"],
      ["no entries", () => ({ entries: [] })],
      [
        "too many entries",
        () => ({ entries: Array.from({ length: 51 }, () => entry("delivered", 0, at(1))) }),
      ],
      ["unknown field", () => ({ entries: [{ ...entry("delivered", 0, at(1)), extra: 1 }] })],
      ["extra top-level field", () => ({ ...valid(), driverId: "x" })],
      ["bad id", () => ({ entries: [{ ...entry("delivered", 0, at(1)), clientMutationId: "1" }] })],
      ["bad reason", () => ({ entries: [entry("problem", 0, at(1), { reason: "BORED" })] })],
      [
        "note too long",
        () => ({
          entries: [entry("problem", 0, at(1), { reason: "CLOSED", note: "x".repeat(501) })],
        }),
      ],
      ["bad time", () => ({ entries: [entry("delivered", 0, "yesterday")] })],
    ])("rejects %s with 400", async (_name, body) => {
      state.session = { user: { id: driverId } };
      expect((await driverSyncResponse(request(body()), SERVER_NOW)).status).toBe(400);
      expect(await t.prisma.stopMutation.count()).toBe(0);
    });

    it("only accepts JSON bodies and bounded sizes", async () => {
      state.session = { user: { id: driverId } };
      const form = request(JSON.stringify(valid()), { "Content-Type": "text/plain" });
      expect((await driverSyncResponse(form, SERVER_NOW)).status).toBe(415);
      const huge = request(" ".repeat(300 * 1024));
      expect((await driverSyncResponse(huge, SERVER_NOW)).status).toBe(413);
    });
  });
});
