// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Prisma } from "@/generated/prisma/client";
import { createLocalizedText } from "@/lib/localized-text";

import { scrubExpiredDriverTexts } from "./data-retention";
import { createTestDb, type TestDb } from "./test-db";
import { getTourPlan } from "./tour-planning";
import { stopProblemNoteSource } from "./translation-pending";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-18T03:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

describe.skipIf(!process.env.DATABASE_URL)(
  "driver text retention (database)",
  { timeout: 60_000 },
  () => {
    let t: TestDb;
    let customerId: string;
    let tourId: string;
    let seq = 0;
    beforeAll(async () => {
      t = await createTestDb();
      customerId = (
        await t.prisma.customer.create({
          data: {
            customerNumber: "R1",
            name: "Trattoria Retention",
            street: "Hauptstraße 1",
            postalCode: "1010",
            city: "Wien",
            lat: 48.2,
            lng: 16.3,
            pinConfirmed: true,
          },
        })
      ).id;
      tourId = (
        await t.prisma.tour.create({
          data: {
            date: new Date("2025-01-02T00:00:00Z"),
            status: "COMPLETED",
            depotSnapshot: { name: "Depot", address: "x", lat: 48.2, lng: 16.3 },
          },
        })
      ).id;
    }, 60_000);
    afterAll(async () => {
      await t?.teardown();
    });

    const note = (text: string, pending = false) =>
      createLocalizedText(
        pending ? { "zh-Hans": text } : { "zh-Hans": text, de: `${text} (de)` },
        "zh-Hans",
        { now: ago(400), pendingTranslation: pending },
      ) as unknown as Prisma.InputJsonValue;

    const makeStop = (
      completedDaysAgo: number | null,
      problemNote: Prisma.InputJsonValue | typeof Prisma.DbNull,
      extra: Partial<Prisma.StopUncheckedCreateInput> = {},
    ) =>
      t.prisma.stop.create({
        data: {
          tourId,
          customerId,
          sequence: ++seq,
          status: completedDaysAgo === null ? "PENDING" : "PROBLEM",
          problemReason: completedDaysAgo === null ? null : "CLOSED",
          problemNote,
          completedAt: completedDaysAgo === null ? null : ago(completedDaysAgo),
          items: [{ productId: "p", quantityCents: 500 }],
          ...extra,
        },
      });
    const row = (id: string) => t.prisma.stop.findUniqueOrThrow({ where: { id } });
    const run = (mode: "dry-run" | "delete" | "off" = "delete", retentionDays = 365) =>
      scrubExpiredDriverTexts({ db: t.prisma, now: NOW, mode, retentionDays, batchSize: 2 });

    it("dry-run reports the expired texts and changes nothing", async () => {
      const old = await makeStop(400, note("alt-dry"));
      const before = await row(old.id);
      const report = await run("dry-run");
      expect(report).toMatchObject({ mode: "dry-run", scrubbed: 0, batches: 0 });
      expect(report.expired).toBeGreaterThanOrEqual(1);
      expect(await row(old.id)).toEqual(before);
      expect((await run("off")).expired).toBe(0);
      expect(await row(old.id)).toEqual(before);
    });

    it("scrubs old texts, keeps recent ones, and leaves reasons, statuses and the rest untouched", async () => {
      const old = await makeStop(400, note("alt"));
      const recent = await makeStop(100, note("neu"));
      const delivered = await makeStop(500, Prisma.DbNull, {
        status: "DELIVERED",
        problemReason: null,
      });
      const pendingStop = await makeStop(null, Prisma.DbNull);
      const beforeOld = await row(old.id);
      const beforeRecent = await row(recent.id);
      const beforeDelivered = await row(delivered.id);

      const report = await run("delete");
      expect(report.scrubbed).toBeGreaterThanOrEqual(1);
      expect(report.mode).toBe("delete");

      const afterOld = await row(old.id);
      expect(afterOld.problemNote).toBeNull();
      expect({ ...afterOld, problemNote: undefined }).toEqual({
        ...beforeOld,
        problemNote: undefined,
      });
      expect(afterOld.problemReason).toBe("CLOSED");
      expect(afterOld.status).toBe("PROBLEM");
      expect(afterOld.completedAt).toEqual(beforeOld.completedAt);
      expect(afterOld.items).toEqual(beforeOld.items);

      expect(await row(recent.id)).toEqual(beforeRecent);
      expect(await row(delivered.id)).toEqual(beforeDelivered);
      expect((await row(pendingStop.id)).problemNote).toBeNull();
      // Tour and customer are never touched.
      expect(await t.prisma.tour.count({ where: { id: tourId } })).toBe(1);
      expect(await t.prisma.customer.count({ where: { id: customerId } })).toBe(1);
    });

    it("scrubs a note still waiting for its translation; the retry job then finds nothing", async () => {
      const pending = await makeStop(500, note("待翻译", true));
      const pendingRecent = await makeStop(10, note("待翻译2", true));
      expect((await stopProblemNoteSource.find(t.prisma, 50)).map((r) => r.id)).toContain(
        pending.id,
      );
      await run("delete");
      expect((await row(pending.id)).problemNote).toBeNull();
      const stillPending = (await stopProblemNoteSource.find(t.prisma, 50)).map((r) => r.id);
      expect(stillPending).not.toContain(pending.id);
      expect(stillPending).toContain(pendingRecent.id);
      // A late translation save against the scrubbed row is a no-op, it never resurrects the text.
      const previous = createLocalizedText({ "zh-Hans": "待翻译" }, "zh-Hans", {
        now: ago(400),
        pendingTranslation: true,
      });
      const next = createLocalizedText({ "zh-Hans": "待翻译", de: "x" }, "zh-Hans", {
        now: ago(400),
      });
      expect(await stopProblemNoteSource.save(t.prisma, pending.id, previous, next)).toBe(false);
      expect((await row(pending.id)).problemNote).toBeNull();
    });

    it("is idempotent and works through a backlog in batches", async () => {
      const ids: string[] = [];
      for (let i = 0; i < 5; i += 1) ids.push((await makeStop(600 + i, note(`b${i}`))).id);
      const first = await scrubExpiredDriverTexts({
        db: t.prisma,
        now: NOW,
        mode: "delete",
        retentionDays: 365,
        batchSize: 2,
        maxBatches: 2,
      });
      expect(first).toMatchObject({ scrubbed: 4, batches: 2, more: true });
      const second = await run("delete");
      expect(second.scrubbed).toBe(1);
      for (const id of ids) expect((await row(id)).problemNote).toBeNull();
      const third = await run("delete");
      expect(third).toMatchObject({ scrubbed: 0, expired: 0, batches: 0, more: false });
    });

    it("the planning view of a day still shows the stop, its reason and status without the text", async () => {
      const day = await t.prisma.tour.create({
        data: {
          date: new Date("2025-03-03T00:00:00Z"),
          status: "COMPLETED",
          depotSnapshot: { name: "Depot", address: "x", lat: 48.2, lng: 16.3 },
        },
      });
      const stop = await t.prisma.stop.create({
        data: {
          tourId: day.id,
          customerId,
          sequence: 1,
          status: "PROBLEM",
          problemReason: "NO_PARKING",
          problemNote: note("kein Platz"),
          completedAt: ago(400),
          items: [],
        },
      });
      const find = async () =>
        (await getTourPlan(t.prisma, "2025-03-03", "Europe/Vienna"))!.tour!.stops.find(
          (s) => s.id === stop.id,
        )!;
      expect((await find()).problemNote?.text).toBe("kein Platz");
      await run("delete");
      const after = await find();
      expect(after.problemNote).toBeNull();
      expect(after).toMatchObject({ status: "PROBLEM", problemReason: "NO_PARKING" });
    });

    it("respects a longer period", async () => {
      const s = await makeStop(400, note("lang"));
      await run("delete", 730);
      expect((await row(s.id)).problemNote).not.toBeNull();
      await run("delete", 365);
      expect((await row(s.id)).problemNote).toBeNull();
    });
  },
);
