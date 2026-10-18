// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { cleanupOrphanedObjects } from "./orphan-cleanup";
import { FakeStorage } from "./storage/fake";
import { createTestDb, type TestDb } from "./test-db";

const DAY = 24 * 60 * 60 * 1000;
let n = 0;
const uuid = () => `11111111-1111-4111-8111-${String(++n).padStart(12, "0")}`;

describe.skipIf(!process.env.DATABASE_URL)("orphan cleanup (database)", { timeout: 60_000 }, () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  }, 60_000);
  afterAll(async () => {
    await t?.teardown();
  });

  it("keeps everything a Photo or Screenshot row names (also replaced photos) and removes the rest", async () => {
    const db = t.prisma;
    const storage = new FakeStorage();
    const user = await db.user.create({
      data: { role: "ADMIN", email: "orph@example.com", passwordHash: "x", displayName: "O" },
    });
    const customer = await db.customer.create({
      data: {
        customerNumber: "O-1",
        name: "Orphan",
        street: "S 1",
        postalCode: "1010",
        city: "Wien",
      },
    });
    const old = new Date(Date.now() - 60 * DAY);
    const put = (key: string) => storage.put(key, new Uint8Array([1]), "image/jpeg", old);

    const current = `customers/${uuid()}.jpg`;
    const replaced = `customers/${uuid()}.jpg`;
    const shot = `screenshots/${uuid()}.png`;
    const orphanPhoto = `customers/${uuid()}.jpg`;
    const orphanShot = `screenshots/${uuid()}.jpg`;
    [current, replaced, shot, orphanPhoto, orphanShot].forEach(put);
    const others = Array.from({ length: 20 }, () => `customers/${uuid()}.jpg`);
    others.forEach(put);

    await db.photo.create({
      data: {
        customerId: customer.id,
        kind: "STORE",
        storageKey: replaced,
        width: 1,
        height: 1,
        bytes: 1,
        uploadedById: user.id,
        isCurrent: false,
      },
    });
    await db.photo.create({
      data: {
        customerId: customer.id,
        kind: "STORE",
        storageKey: current,
        width: 1,
        height: 1,
        bytes: 1,
        uploadedById: user.id,
        isCurrent: true,
      },
    });
    await db.screenshot.create({ data: { storageKey: shot, uploadedById: user.id } });
    for (const key of others) {
      await db.photo.create({
        data: {
          customerId: customer.id,
          kind: "PARKING",
          storageKey: key,
          width: 1,
          height: 1,
          bytes: 1,
          uploadedById: user.id,
          isCurrent: false,
        },
      });
    }

    const dry = await cleanupOrphanedObjects({ db, storage, mode: "dry-run", graceDays: 14 });
    expect(dry).toMatchObject({ orphans: 2, deleted: 0 });
    expect([...dry.sample].sort()).toEqual([orphanPhoto, orphanShot].sort());

    const real = await cleanupOrphanedObjects({ db, storage, mode: "delete", graceDays: 14 });
    expect(real).toMatchObject({ orphans: 2, deleted: 2, failed: 0 });
    expect(storage.has(orphanPhoto)).toBe(false);
    expect(storage.has(orphanShot)).toBe(false);
    for (const kept of [current, replaced, shot, ...others])
      expect(storage.has(kept), kept).toBe(true);
  });
});
