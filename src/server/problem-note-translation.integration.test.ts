// @vitest-environment node
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hashSecret } from "./auth/password";
import { applyStopMutation } from "./stop-status";
import { createTestDb, type TestDb } from "./test-db";
import { retryPendingTranslations } from "./translation-retry";
import { FakeTranslator } from "./translator/fake";
import { type Translator, TranslatorError } from "./translator/types";

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

const { translateStopProblemNote, scheduleProblemNoteTranslation } =
  await import("./problem-note-translation");
const { stopStatusAction } = await import("./stop-status-actions");
const { getTourPlan } = await import("./tour-planning");

const NOW = new Date("2099-07-02T08:00:00Z");
const NOTE_HK = "門口鎖住了，沒人應門";

const down: Translator = {
  kind: "deepl",
  async translate() {
    throw new TranslatorError("outage", "HTTP", 503);
  },
};

describe.skipIf(!process.env.DATABASE_URL)("problem note translation", { timeout: 60_000 }, () => {
  let t: TestDb;
  let driverId: string;
  let stopIds: string[];
  const stopRow = (i: number) => t.prisma.stop.findUniqueOrThrow({ where: { id: stopIds[i] } });
  const report = (i: number, note: string | undefined, locale: string) =>
    applyStopMutation(
      t.prisma,
      { id: driverId, role: "DRIVER", locale },
      {
        type: "problem",
        stopId: stopIds[i],
        clientMutationId: randomUUID(),
        reason: "CLOSED",
        note,
      },
      NOW,
    );

  beforeAll(async () => {
    t = await createTestDb();
    state.db = t.prisma;
    driverId = (
      await t.prisma.user.create({
        data: {
          role: "DRIVER",
          username: "drv",
          displayName: "Driver",
          passwordHash: await hashSecret("123456"),
          locale: "zh_Hant_HK",
          localeChosen: true,
        },
      })
    ).id;
    const tour = await t.prisma.tour.create({
      data: {
        date: new Date("2099-07-02T00:00:00Z"),
        driverId,
        status: "RELEASED",
        releaseRevision: 1,
        depotSnapshot: { name: "Depot", address: "x", lat: 48.2, lng: 16.3 },
      },
    });
    stopIds = [];
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
      stopIds.push(
        (
          await t.prisma.stop.create({
            data: { tourId: tour.id, customerId: c.id, sequence: n, items: [] },
          })
        ).id,
      );
    }
  });

  beforeEach(async () => {
    state.session = null;
    await t.prisma.stopMutation.deleteMany();
    await t.prisma.stop.updateMany({
      where: {},
      data: {
        status: "PENDING",
        problemReason: null,
        problemNote: undefined,
        completedAt: null,
        clientMutationId: null,
      },
    });
    await t.prisma.tour.updateMany({ data: { status: "RELEASED", completedAt: null } });
  });

  afterAll(async () => {
    await t?.teardown();
  });

  it("the mutation stores a Chinese note as pending and never calls the translator", async () => {
    const res = await report(0, NOTE_HK, "zh-Hant-HK");
    expect(res).toMatchObject({ ok: true, status: "PROBLEM" });
    expect((await stopRow(0)).problemNote).toMatchObject({
      "zh-Hant-HK": NOTE_HK,
      meta: { source: "zh-Hant-HK", pendingTranslation: true },
    });
  });

  it("translates to German after the commit (Fake translator: [de] prefix) and keeps the original", async () => {
    await report(0, NOTE_HK, "zh-Hant-HK");
    expect(
      await translateStopProblemNote(t.prisma, stopIds[0], { translator: new FakeTranslator() }),
    ).toBe("translated");
    const note = (await stopRow(0)).problemNote as Record<string, unknown> & {
      meta: Record<string, unknown>;
    };
    expect(note["zh-Hant-HK"]).toBe(NOTE_HK);
    expect(note.de).toMatch(/^\[de\] /);
    expect(note.meta).toMatchObject({ source: "zh-Hant-HK", machine: { de: true } });
    expect(note.meta.pendingTranslation).toBeUndefined();
    // Nothing left to do on a second call.
    expect(
      await translateStopProblemNote(t.prisma, stopIds[0], { translator: new FakeTranslator() }),
    ).toBe("skipped");
  });

  it("a German note needs no translation and is not marked pending", async () => {
    await report(1, "Baustelle vor dem Eingang", "de");
    const note = (await stopRow(1)).problemNote as { meta: Record<string, unknown> };
    expect(note.meta.pendingTranslation).toBeUndefined();
    const spy = vi.fn(async () => "x");
    expect(
      await translateStopProblemNote(t.prisma, stopIds[1], {
        translator: { kind: "deepl", translate: spy },
      }),
    ).toBe("skipped");
    expect(spy).not.toHaveBeenCalled();
  });

  it("a provider outage leaves the note pending; the mutation result is unaffected; the retry job completes it later", async () => {
    const res = await report(2, NOTE_HK, "zh-Hant-HK");
    expect(res).toMatchObject({ ok: true, status: "PROBLEM", tourStatus: "IN_PROGRESS" });
    expect(await translateStopProblemNote(t.prisma, stopIds[2], { translator: down })).toBe(
      "pending",
    );
    expect((await stopRow(2)).problemNote).toMatchObject({ meta: { pendingTranslation: true } });
    expect((await stopRow(2)).status).toBe("PROBLEM");

    const run = await retryPendingTranslations({ db: t.prisma, translator: new FakeTranslator() });
    expect(run.sources["Stop.problemNote"]?.translated).toBe(1);
    expect((await stopRow(2)).problemNote).toMatchObject({ de: `[de] ${NOTE_HK}` });
  });

  it("scheduling never throws and does nothing for replays, delivered stops and rejections", async () => {
    const scheduled: unknown[] = [];
    const schedule = (task: () => Promise<unknown>) => void scheduled.push(task);
    const problem = await report(3, NOTE_HK, "zh-Hant-HK");
    scheduleProblemNoteTranslation(t.prisma, problem, schedule);
    expect(scheduled).toHaveLength(1);

    if (!problem.ok) throw new Error("setup");
    scheduleProblemNoteTranslation(t.prisma, { ...problem, replayed: true }, schedule);
    scheduleProblemNoteTranslation(t.prisma, { ...problem, status: "DELIVERED" }, schedule);
    scheduleProblemNoteTranslation(t.prisma, { ...problem, kind: "UNDO" }, schedule);
    scheduleProblemNoteTranslation(t.prisma, { ok: false, error: "not_found" }, schedule);
    expect(scheduled).toHaveLength(1);

    expect(() =>
      scheduleProblemNoteTranslation(t.prisma, problem, () => {
        throw new Error("no request scope");
      }),
    ).not.toThrow();
  });

  it("the driver's server action succeeds even when the translation cannot be scheduled", async () => {
    state.session = { user: { id: driverId } };
    const res = await stopStatusAction({
      type: "problem",
      stopId: stopIds[0],
      clientMutationId: randomUUID(),
      reason: "NOBODY_THERE",
      note: NOTE_HK,
    });
    expect(res).toMatchObject({ ok: true, status: "PROBLEM" });
    expect((await stopRow(0)).problemNote).toMatchObject({ meta: { pendingTranslation: true } });
  });

  it("an undone report is not overwritten by a late translation", async () => {
    const res = await report(0, NOTE_HK, "zh-Hant-HK");
    if (!res.ok) throw new Error("setup");
    await applyStopMutation(
      t.prisma,
      { id: driverId, role: "DRIVER", locale: "zh-Hant-HK" },
      { type: "undo", stopId: stopIds[0], clientMutationId: randomUUID() },
      NOW,
    );
    expect(
      await translateStopProblemNote(t.prisma, stopIds[0], { translator: new FakeTranslator() }),
    ).toBe("skipped");
    expect((await stopRow(0)).problemNote).toBeNull();
  });

  it("the tour plan carries the German version, the original and the pending state", async () => {
    await report(0, NOTE_HK, "zh-Hant-HK");
    await report(1, "Baustelle", "de");
    await report(2, "门关着", "zh-Hans");
    await translateStopProblemNote(t.prisma, stopIds[0], { translator: new FakeTranslator() });
    const plan = await getTourPlan(t.prisma, "2099-07-02", "Europe/Vienna");
    const notes = plan!.tour!.stops.map((s) => s.problemNote);
    expect(notes[0]).toEqual({
      text: NOTE_HK,
      locale: "zh-Hant-HK",
      german: `[de] ${NOTE_HK}`,
      germanMachine: true,
      pending: false,
    });
    expect(notes[1]).toEqual({
      text: "Baustelle",
      locale: "de",
      german: null,
      germanMachine: false,
      pending: false,
    });
    expect(notes[2]).toMatchObject({ locale: "zh-Hans", german: null, pending: true });
  });
});
