// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { purgeExpiredScreenshots } from "./screenshot-retention";
import { FakeStorage } from "./storage/fake";
import { createTestDb, type TestDb } from "./test-db";

const DAY = 24 * 60 * 60 * 1000;

describe.skipIf(!process.env.DATABASE_URL)(
  "screenshot retention (database)",
  { timeout: 60_000 },
  () => {
    let t: TestDb;
    beforeAll(async () => {
      t = await createTestDb();
    }, 60_000);
    afterAll(async () => {
      await t?.teardown();
    });

    it("removes object and row, keeps the order (screenshotId becomes NULL) and younger screenshots", async () => {
      const db = t.prisma;
      const storage = new FakeStorage();
      const user = await db.user.create({
        data: { role: "ADMIN", email: "ret@example.com", passwordHash: "x", displayName: "R" },
      });
      const customer = await db.customer.create({
        data: {
          customerNumber: "R-1",
          name: "Retention",
          street: "S 1",
          postalCode: "1010",
          city: "Wien",
        },
      });
      const now = new Date();
      const mk = async (key: string, ageDays: number) => {
        storage.put(key, new Uint8Array([1, 2]), "image/jpeg");
        return db.screenshot.create({
          data: {
            storageKey: key,
            uploadedById: user.id,
            createdAt: new Date(now.getTime() - ageDays * DAY),
          },
        });
      };
      const old = await mk("screenshots/old.jpg", 200);
      const recent = await mk("screenshots/recent.jpg", 10);
      const orderOld = await db.order.create({
        data: {
          customerId: customer.id,
          deliveryDate: new Date("2030-01-01"),
          windowFrom: new Date("2030-01-01"),
          windowTo: new Date("2030-01-01"),
          source: "SCREENSHOT",
          screenshotId: old.id,
          createdById: user.id,
        },
      });
      const orderRecent = await db.order.create({
        data: {
          customerId: customer.id,
          deliveryDate: new Date("2030-01-02"),
          windowFrom: new Date("2030-01-02"),
          windowTo: new Date("2030-01-02"),
          source: "SCREENSHOT",
          screenshotId: recent.id,
          createdById: user.id,
        },
      });

      const report = await purgeExpiredScreenshots({ db, storage, now, retentionDays: 180 });
      expect(report).toMatchObject({ examined: 1, deleted: 1, failed: 0, more: false });

      expect(storage.has("screenshots/old.jpg")).toBe(false);
      expect(storage.has("screenshots/recent.jpg")).toBe(true);
      expect(await db.screenshot.findUnique({ where: { id: old.id } })).toBeNull();
      expect(await db.screenshot.findUnique({ where: { id: recent.id } })).not.toBeNull();
      expect(
        (await db.order.findUniqueOrThrow({ where: { id: orderOld.id } })).screenshotId,
      ).toBeNull();
      expect(
        (await db.order.findUniqueOrThrow({ where: { id: orderRecent.id } })).screenshotId,
      ).toBe(recent.id);

      // idempotent
      expect(await purgeExpiredScreenshots({ db, storage, now, retentionDays: 180 })).toMatchObject(
        {
          examined: 0,
          deleted: 0,
        },
      );
    });
  },
);
