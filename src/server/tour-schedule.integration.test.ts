// @vitest-environment node
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { hashSecret } from "./auth/password";
import { createTestDb, type TestDb } from "./test-db";

// NUD-172 (QA 2026-10-29, F3): the plan is re-anchored to reality, so a tour released after its
// planned start and every completed stop carry arrival times that are still true.
const state: { db: TestDb["prisma"] | null } = { db: null };
vi.mock("next/cache", () => ({
  updateTag: vi.fn(),
  cacheTag: vi.fn(),
  cacheLife: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  getDb: () => state.db,
}));

const { applyStopMutation } = await import("./stop-status");
const { rebaseOnRelease, rebaseTourSchedule } = await import("./tour-schedule");

const MIN = 60_000;
const SERVICE = 15;
const T0 = new Date("2099-07-02T08:00:00Z");

describe.skipIf(!process.env.DATABASE_URL)("tour schedule rebase", { timeout: 60_000 }, () => {
  let t: TestDb;
  let driverId: string;
  let tourId: string;
  let stopIds: string[];

  const actor = () => ({ id: driverId, role: "DRIVER" as const, locale: "de" });
  const etas = async () =>
    (
      await t.prisma.stop.findMany({
        where: { tourId },
        orderBy: { sequence: "asc" },
        select: { status: true, etaAt: true },
      })
    ).map((s) => ({ status: s.status, eta: s.etaAt?.toISOString() ?? null }));

  async function reset() {
    await t.prisma.stopMutation.deleteMany();
    await t.prisma.stop.updateMany({
      where: { tourId },
      data: {
        status: "PENDING",
        completedAt: null,
        problemReason: null,
        problemNote: undefined,
        clientMutationId: null,
      },
    });
    await t.prisma.tour.update({
      where: { id: tourId },
      data: { status: "RELEASED", completedAt: null, departedAt: null },
    });
    // legs: 10 min to stop 1, 5 min each after that
    for (const [index, id] of stopIds.entries()) {
      await t.prisma.stop.update({
        where: { id },
        data: { etaAt: new Date("2099-07-02T06:30:00Z"), legDurationS: index === 0 ? 600 : 300 },
      });
    }
  }

  beforeAll(async () => {
    t = await createTestDb();
    state.db = t.prisma;
    const hash = await hashSecret("123456");
    driverId = (
      await t.prisma.user.create({
        data: {
          role: "DRIVER",
          username: "drv",
          displayName: "Driver",
          passwordHash: hash,
          locale: "de",
          localeChosen: true,
        },
      })
    ).id;
    await t.prisma.settings.create({
      data: {
        depotName: "Depot",
        depotAddress: "Hauptstraße 1, 1010 Wien",
        depotLat: 48.2,
        depotLng: 16.3,
        timezone: "Europe/Vienna",
        departureTime: "06:30",
        serviceMinutesPerStop: SERVICE,
        defaultLoadingMinutes: 20,
      },
    });
    const tour = await t.prisma.tour.create({
      data: {
        date: new Date("2099-07-02T00:00:00Z"),
        driverId,
        status: "RELEASED",
        releaseRevision: 1,
        depotSnapshot: { name: "Depot", address: "x", lat: 48.2, lng: 16.3 },
      },
    });
    tourId = tour.id;
    stopIds = [];
    for (const n of [1, 2, 3]) {
      const customer = await t.prisma.customer.create({
        data: {
          customerNumber: `K${n}`,
          name: `Trattoria ${n}`,
          street: "Hauptstraße 1",
          postalCode: "1010",
          city: "Wien",
          lat: 48.2 + n / 100,
          lng: 16.3,
          pinConfirmed: true,
        },
      });
      const stop = await t.prisma.stop.create({
        data: { tourId, customerId: customer.id, sequence: n, items: [] },
      });
      stopIds.push(stop.id);
    }
    await reset();
  });

  afterAll(async () => {
    await t?.teardown();
  });

  it("moves every open arrival time onto the anchor, in sequence, with service time", async () => {
    await rebaseTourSchedule(t.prisma, tourId, T0);
    const list = await etas();
    expect(list).toEqual([
      // 10 min drive, then service, 5 min drive, ...
      { status: "PENDING", eta: new Date(T0.getTime() + 10 * MIN).toISOString() },
      { status: "PENDING", eta: new Date(T0.getTime() + 30 * MIN).toISOString() },
      { status: "PENDING", eta: new Date(T0.getTime() + 50 * MIN).toISOString() },
    ]);
  });

  it("keeps the arrival time a stop had when the driver worked it", async () => {
    const before = (await etas())[0]!;
    await t.prisma.stop.update({
      where: { id: stopIds[0]! },
      data: { status: "DELIVERED", completedAt: T0 },
    });
    const anchor = new Date(T0.getTime() + 3 * 60 * MIN);
    await rebaseTourSchedule(t.prisma, tourId, anchor);
    const list = await etas();
    // the completed stop keeps what it had; the two open stops count from the driver's position
    expect(list[0]).toEqual({ status: "DELIVERED", eta: before.eta });
    expect(list[1]?.eta).toBe(new Date(anchor.getTime() + 5 * MIN).toISOString());
  });

  it("does nothing for a plan that still starts in the future", async () => {
    const before = await etas();
    await rebaseOnRelease(t.prisma, tourId, new Date("2099-07-01T10:00:00Z"));
    expect(await etas()).toEqual(before);
  });

  it("re-anchors a tour that was released after its planned start to now + loading time", async () => {
    // planned start 06:30 Vienna = 04:30Z, `now` is 08:00Z -> already two and a half hours late
    const now = new Date("2099-07-02T08:00:00Z");
    await rebaseOnRelease(t.prisma, tourId, now);
    const open = (await etas()).filter((s) => s.status === "PENDING");
    expect(open[0]?.eta).toBe(new Date(now.getTime() + 20 * MIN + 5 * MIN).toISOString());
    expect(new Date(open[0]!.eta!).getTime()).toBeGreaterThan(now.getTime());
  });

  it("uses the real departure after a re-release, never the planned one again", async () => {
    const departedAt = new Date("2099-07-02T09:00:00Z");
    await t.prisma.tour.update({ where: { id: tourId }, data: { departedAt } });
    await rebaseOnRelease(t.prisma, tourId, new Date("2099-07-02T15:00:00Z"));
    const open = (await etas()).filter((s) => s.status === "PENDING");
    // the first open stop is 5 minutes after the completed one, so: departure time is the anchor
    expect(new Date(open[0]!.eta!).getTime()).toBeGreaterThan(departedAt.getTime());
    expect(new Date(open[0]!.eta!).getTime()).toBeLessThan(departedAt.getTime() + 60 * MIN);
  });

  it("re-anchors the remaining stops when the driver completes one (QA case)", async () => {
    await reset();
    const completedAt = new Date("2099-07-02T11:44:00Z");
    const result = await applyStopMutation(
      t.prisma,
      actor(),
      { type: "delivered", stopId: stopIds[0]!, clientMutationId: randomUUID() },
      completedAt,
    );
    expect(result).toMatchObject({ ok: true, nextStopId: stopIds[1] });
    const list = await etas();
    // the next stop is 5 minutes away (its stored leg), no arrival before the completion
    expect(list[1]?.eta).toBe(new Date(completedAt.getTime() + 5 * MIN).toISOString());
    expect(new Date(list[1]!.eta!).getTime()).toBeGreaterThan(completedAt.getTime());
  });
});
