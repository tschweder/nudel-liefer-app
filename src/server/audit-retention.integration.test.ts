// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { purgeExpiredAuditEntries } from "./audit-retention";
import { createTestDb, type TestDb } from "./test-db";

const DAY = 24 * 60 * 60 * 1000;

describe.skipIf(!process.env.DATABASE_URL)(
  "audit log retention (database)",
  { timeout: 60_000 },
  () => {
    let t: TestDb;
    beforeAll(async () => {
      t = await createTestDb();
    }, 60_000);
    afterAll(async () => {
      await t?.teardown();
    });

    const seed = async (tag: string, ageDays: number, count = 1) => {
      const createdAt = new Date(Date.now() - ageDays * DAY);
      await t.prisma.auditLog.createMany({
        data: Array.from({ length: count }, (_, i) => ({
          actorId: "a",
          entity: "Order",
          entityId: `${tag}-${i}`,
          action: "order.update",
          diff: {},
          createdAt,
        })),
      });
    };
    const ids = async (tag: string) =>
      (await t.prisma.auditLog.findMany({ where: { entityId: { startsWith: `${tag}-` } } })).length;
    /** What a buggy or malicious caller could try: lift the switch and delete everything. */
    const forcedDelete = (where: string) =>
      t.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('nudel.audit_retention', 'on', true)`;
        return tx.$executeRawUnsafe(`DELETE FROM "AuditLog" WHERE ${where}`);
      });

    it("deletes old entries and keeps younger ones", async () => {
      await seed("old", 800, 3);
      await seed("mid", 400, 2);
      await seed("new", 1, 2);
      const report = await purgeExpiredAuditEntries({ db: t.prisma, retentionDays: 730 });
      expect(report).toMatchObject({ deleted: 3, more: false });
      expect(await ids("old")).toBe(0);
      expect(await ids("mid")).toBe(2);
      expect(await ids("new")).toBe(2);
    });

    it("respects a shorter configured period down to the floor", async () => {
      await seed("p100", 100, 1);
      await seed("p80", 80, 1);
      const report = await purgeExpiredAuditEntries({ db: t.prisma, retentionDays: 90 });
      expect(report.deleted).toBeGreaterThanOrEqual(1);
      expect(await ids("p100")).toBe(0);
      expect(await ids("p80")).toBe(1);
    });

    it("deletes in bounded batches and reports that more is left", async () => {
      await seed("bulk", 900, 25);
      const first = await purgeExpiredAuditEntries({
        db: t.prisma,
        retentionDays: 730,
        batchSize: 10,
        maxBatches: 2,
      });
      expect(first).toMatchObject({ deleted: 20, batches: 2, more: true });
      expect(await ids("bulk")).toBe(5);
      const second = await purgeExpiredAuditEntries({
        db: t.prisma,
        retentionDays: 730,
        batchSize: 10,
        maxBatches: 2,
      });
      expect(second).toMatchObject({ deleted: 5, batches: 1, more: false });
      expect(await ids("bulk")).toBe(0);
    });

    it("recent rows survive even when the app lifts the switch and tries to delete them", async () => {
      await seed("keep", 10, 2);
      await seed("keep89", 89, 1);
      await expect(forcedDelete(`"entityId" LIKE 'keep-%'`)).rejects.toThrow(/older than 90 days/);
      await expect(forcedDelete(`"entityId" LIKE 'keep89-%'`)).rejects.toThrow(
        /older than 90 days/,
      );
      await expect(forcedDelete("true")).rejects.toThrow(/older than 90 days/);
      expect(await ids("keep")).toBe(2);
      expect(await ids("keep89")).toBe(1);
    });

    it("plain DELETE and UPDATE without the switch still fail, with or without it for UPDATE", async () => {
      await seed("plain", 2000, 1);
      await expect(t.prisma.auditLog.deleteMany({})).rejects.toThrow(/append-only/);
      await expect(
        t.prisma.auditLog.updateMany({ data: { action: "order.cancel" } }),
      ).rejects.toThrow(/append-only/);
      await expect(
        t.prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('nudel.audit_retention', 'on', true)`;
          return tx.$executeRawUnsafe(`UPDATE "AuditLog" SET "action" = 'x'`);
        }),
      ).rejects.toThrow(/append-only/);
      // The switch is transaction-local: a later plain delete fails again, also for an old row.
      await expect(
        t.prisma.auditLog.deleteMany({ where: { entityId: { startsWith: "plain-" } } }),
      ).rejects.toThrow(/append-only/);
      expect(await ids("plain")).toBe(1);
    });

    it("the job refuses a period below the floor without touching the database", async () => {
      await expect(purgeExpiredAuditEntries({ db: t.prisma, retentionDays: 30 })).rejects.toThrow(
        /refused/,
      );
      expect(await ids("p80")).toBe(1);
    });
  },
);
