// @vitest-environment node
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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

const { applyStopMutation } = await import("./stop-status");
const { getTodayProgress, todayProgressQuery } = await import("./tour-progress");
const { getTourPlan } = await import("./tour-planning");
const { todayInTimezone } = await import("./driver-today");

const TZ = "Europe/Vienna";

describe.skipIf(!process.env.DATABASE_URL)("admin live tour progress", { timeout: 60_000 }, () => {
  let t: TestDb;
  let adminId: string;
  let driverId: string;
  let stopIds: string[];
  const now = new Date();
  const today = todayInTimezone(now, TZ);

  const mutate = (input: Record<string, unknown>, at = now) =>
    applyStopMutation(
      t.prisma,
      { id: driverId, role: "DRIVER", locale: "zh-Hans" },
      { clientMutationId: randomUUID(), ...input },
      at,
    );

  beforeAll(async () => {
    t = await createTestDb();
    state.db = t.prisma;
    const hash = await hashSecret("123456");
    adminId = (
      await t.prisma.user.create({
        data: { role: "ADMIN", email: "a@example.com", displayName: "A", passwordHash: hash },
      })
    ).id;
    driverId = (
      await t.prisma.user.create({
        data: {
          role: "DRIVER",
          username: "drv",
          displayName: "Hans Fahrer",
          passwordHash: hash,
          locale: "zh_Hans",
          localeChosen: true,
        },
      })
    ).id;
    const tour = await t.prisma.tour.create({
      data: {
        date: new Date(`${today}T00:00:00Z`),
        driverId,
        status: "RELEASED",
        releaseRevision: 1,
        depotSnapshot: { name: "Depot", address: "x", lat: 48.2, lng: 16.3 },
      },
    });
    stopIds = [];
    for (const n of [1, 2, 3]) {
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
      const s = await t.prisma.stop.create({
        data: {
          tourId: tour.id,
          customerId: c.id,
          sequence: n,
          items: [],
          etaAt: new Date(now.getTime() + n * 600_000),
        },
      });
      stopIds.push(s.id);
    }
  });

  afterAll(async () => {
    await t?.teardown();
  });

  it("reports an empty day without a tour", async () => {
    const other = await getTodayProgress(t.prisma, {
      now: new Date("2099-01-05T10:00:00Z"),
      timezone: TZ,
    });
    expect(other).toEqual({ date: "2099-01-05", timezone: TZ, tour: null });
  });

  it("follows the driver: nothing done, delivered, problem, finished", async () => {
    const read = () => getTodayProgress(t.prisma, { now, timezone: TZ });

    let r = await read();
    expect(r.tour).toMatchObject({
      status: "RELEASED",
      driverName: "Hans Fahrer",
      progress: { total: 3, done: 0, problems: 0, percent: 0 },
      nextStop: { id: stopIds[0], name: "Trattoria 1" },
      problemStops: [],
    });

    expect(await mutate({ type: "delivered", stopId: stopIds[0] })).toMatchObject({ ok: true });
    r = await read();
    expect(r.tour).toMatchObject({
      status: "IN_PROGRESS",
      progress: { done: 1, delivered: 1, percent: 33 },
      nextStop: { id: stopIds[1] },
    });

    expect(
      await mutate({ type: "problem", stopId: stopIds[1], reason: "CLOSED", note: "门关着" }),
    ).toMatchObject({ ok: true });
    r = await read();
    expect(r.tour?.progress).toMatchObject({ done: 2, problems: 1, delivered: 1, percent: 67 });
    expect(r.tour?.problemStops).toEqual([
      { id: stopIds[1], name: "Trattoria 2", reason: "CLOSED" },
    ]);

    expect(await mutate({ type: "delivered", stopId: stopIds[2] })).toMatchObject({ ok: true });
    r = await read();
    expect(r.tour).toMatchObject({
      status: "COMPLETED",
      progress: { done: 3, percent: 100, nextStopId: null },
      nextStop: null,
    });
  });

  it("gives the tour page the completion time, reason and the original driver text", async () => {
    const plan = await getTourPlan(t.prisma, today, TZ);
    const stops = plan!.tour!.stops;
    expect(stops.map((s) => s.status)).toEqual(["DELIVERED", "PROBLEM", "DELIVERED"]);
    expect(stops[0]).toMatchObject({ problemReason: null, problemNote: null });
    expect(stops[0].completedAt).toBe(now.toISOString());
    expect(stops[1]).toMatchObject({
      problemReason: "CLOSED",
      problemNote: { text: "门关着", locale: "zh-Hans" },
    });
  });

  describe("authorization", () => {
    it("rejects anonymous callers and drivers on the dashboard read", async () => {
      state.session = null;
      await expect(todayProgressQuery()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
      state.session = { user: { id: driverId } };
      await expect(todayProgressQuery()).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("rejects a deactivated admin and lets an active admin read", async () => {
      const other = await t.prisma.user.create({
        data: {
          role: "ADMIN",
          email: "b@example.com",
          displayName: "B",
          passwordHash: "x",
          active: false,
        },
      });
      state.session = { user: { id: other.id } };
      await expect(todayProgressQuery()).rejects.toBeTruthy();
      state.session = { user: { id: adminId } };
      const r = await todayProgressQuery();
      expect(r.tour?.progress.total).toBe(3);
    });
  });
});
