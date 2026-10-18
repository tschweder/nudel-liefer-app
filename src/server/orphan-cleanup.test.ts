// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { cleanupOrphanedObjects, orphanCleanupMode, orphanGraceDays } from "./orphan-cleanup";
import { handleOrphanCleanupCron } from "./orphan-cleanup-cron";
import { FakeStorage } from "./storage/fake";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-18T12:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
let counter = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
const photoKey = () => `customers/${uuid()}.jpg`;
const shotKey = () => `screenshots/${uuid()}.png`;

/** Minimal Prisma stand-in: only `findMany({ where: { storageKey: { in } } })`. */
function fakeDb(photos: string[], screenshots: string[]) {
  const table = (keys: string[]) => ({
    findMany: vi.fn(async ({ where }: { where: { storageKey: { in: string[] } } }) =>
      keys.filter((k) => where.storageKey.in.includes(k)).map((storageKey) => ({ storageKey })),
    ),
  });
  return { photo: table(photos), screenshot: table(screenshots) } as never;
}

function bucket(entries: Array<[string, number]>) {
  const storage = new FakeStorage();
  for (const [key, ageDays] of entries)
    storage.put(key, new Uint8Array([1]), "image/jpeg", ago(ageDays));
  return storage;
}

describe("settings", () => {
  it("defaults to a dry run and ignores garbage", () => {
    expect(orphanCleanupMode(undefined)).toBe("dry-run");
    expect(orphanCleanupMode("")).toBe("dry-run");
    expect(orphanCleanupMode("yes")).toBe("dry-run");
    expect(orphanCleanupMode(" DELETE ")).toBe("delete");
    expect(orphanCleanupMode("off")).toBe("off");
  });
  it("never allows a grace period shorter than 7 days", () => {
    expect(orphanGraceDays(undefined)).toBe(14);
    expect(orphanGraceDays("abc")).toBe(14);
    expect(orphanGraceDays("-3")).toBe(14);
    expect(orphanGraceDays("0")).toBe(7);
    expect(orphanGraceDays("1")).toBe(7);
    expect(orphanGraceDays("30")).toBe(30);
    expect(orphanGraceDays("99999")).toBe(365);
  });
});

describe("cleanupOrphanedObjects", () => {
  it("deletes only old, unreferenced, app-shaped objects (mode delete)", async () => {
    const keptPhoto = photoKey();
    const keptShot = shotKey();
    const oldOrphanPhoto = photoKey();
    const oldOrphanShot = shotKey();
    const youngOrphan = photoKey();
    const boundary = photoKey();
    const strangers = [
      "customers/readme.txt",
      "customers/x/../y.jpg",
      "screenshots/NOT-A-UUID.png",
      "customers/",
    ];
    const storage = bucket([
      [keptPhoto, 400],
      [keptShot, 400],
      [oldOrphanPhoto, 30],
      [oldOrphanShot, 15],
      [youngOrphan, 13],
      [boundary, 14],
      ...strangers.map((k): [string, number] => [k, 400]),
    ]);
    // Twenty referenced old objects so that two orphans are a plausible minority.
    const referenced = Array.from({ length: 20 }, () => photoKey());
    for (const key of referenced) storage.put(key, new Uint8Array([1]), "image/jpeg", ago(100));
    const db = fakeDb([keptPhoto, ...referenced], [keptShot]);

    const report = await cleanupOrphanedObjects({
      db,
      storage,
      now: NOW,
      mode: "delete",
      graceDays: 14,
    });

    expect(report).toMatchObject({
      mode: "delete",
      graceDays: 14,
      truncated: false,
      unexpected: strangers.length,
      young: 1, // exactly 13 days; the object of exactly 14 days is old enough
      orphans: 3,
      deleted: 3,
      failed: 0,
    });
    expect(storage.has(oldOrphanPhoto)).toBe(false);
    expect(storage.has(oldOrphanShot)).toBe(false);
    expect(storage.has(boundary)).toBe(false);
    for (const survivor of [keptPhoto, keptShot, youngOrphan, ...referenced, ...strangers]) {
      expect(storage.has(survivor), survivor).toBe(true);
    }
  });

  it("reports but does not delete in dry-run mode and does nothing when off", async () => {
    const orphan = photoKey();
    const storage = bucket([[orphan, 100]]);
    const db = fakeDb([], []);
    const dry = await cleanupOrphanedObjects({
      db,
      storage,
      now: NOW,
      mode: "dry-run",
      graceDays: 14,
    });
    expect(dry).toMatchObject({ orphans: 1, deleted: 0, sample: [orphan] });
    expect(storage.has(orphan)).toBe(true);
    const off = await cleanupOrphanedObjects({ db, storage, now: NOW, mode: "off", graceDays: 14 });
    expect(off).toMatchObject({ listed: 0, orphans: 0, deleted: 0 });
    expect(storage.has(orphan)).toBe(true);
  });

  it("refuses to delete when most candidates look orphaned (wrong or empty database)", async () => {
    const keys = Array.from({ length: 30 }, () => photoKey());
    const storage = bucket(keys.map((k): [string, number] => [k, 100]));
    const report = await cleanupOrphanedObjects({
      db: fakeDb([], []),
      storage,
      now: NOW,
      mode: "delete",
      graceDays: 14,
    });
    expect(report).toMatchObject({
      candidates: 30,
      orphans: 30,
      deleted: 0,
      aborted: "suspicious_ratio",
    });
    expect(keys.every((k) => storage.has(k))).toBe(true);
  });

  it("deletes at most maxDeletes objects per run", async () => {
    const referenced = Array.from({ length: 40 }, () => photoKey());
    const orphans = Array.from({ length: 8 }, () => photoKey());
    const storage = bucket([...referenced, ...orphans].map((k): [string, number] => [k, 100]));
    const report = await cleanupOrphanedObjects({
      db: fakeDb(referenced, []),
      storage,
      now: NOW,
      mode: "delete",
      graceDays: 14,
      maxDeletes: 5,
    });
    expect(report).toMatchObject({ orphans: 8, deleted: 5 });
    expect(orphans.filter((k) => storage.has(k))).toHaveLength(3);
  });

  it("re-checks the reference right before deleting", async () => {
    const referenced = Array.from({ length: 30 }, () => photoKey());
    const racing = photoKey();
    const storage = bucket([...referenced, racing].map((k): [string, number] => [k, 100]));
    const rows = [...referenced];
    const db = fakeDb(rows, []) as unknown as {
      photo: {
        findMany: (args: { where: { storageKey: { in: string[] } } }) => Promise<unknown[]>;
      };
    };
    const original = db.photo.findMany;
    let calls = 0;
    db.photo.findMany = async (args) => {
      calls += 1;
      // The first lookup (the bulk check) does not know the row yet; it appears before the delete.
      if (calls === 2) rows.push(racing);
      return original(args);
    };
    const report = await cleanupOrphanedObjects({
      db: db as never,
      storage,
      now: NOW,
      mode: "delete",
      graceDays: 14,
    });
    expect(report.orphans).toBe(1);
    expect(report.deleted).toBe(0);
    expect(storage.has(racing)).toBe(true);
  });

  it("counts a failing delete and carries on", async () => {
    const referenced = Array.from({ length: 30 }, () => photoKey());
    const [a, b] = [photoKey(), photoKey()];
    const storage = bucket([...referenced, a, b].map((k): [string, number] => [k, 100]));
    const realDelete = storage.delete.bind(storage);
    storage.delete = async (key: string) => {
      if (key === a) throw new Error("storage down");
      return realDelete(key);
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
    const report = await cleanupOrphanedObjects({
      db: fakeDb(referenced, []),
      storage,
      now: NOW,
      mode: "delete",
      graceDays: 14,
    });
    expect(report).toMatchObject({ orphans: 2, deleted: 1, failed: 1 });
    expect(storage.has(a)).toBe(true);
    expect(storage.has(b)).toBe(false);
  });

  it("pages through large listings and marks a truncated run", async () => {
    const storage = bucket(Array.from({ length: 2500 }, (): [string, number] => [photoKey(), 100]));
    const all = await cleanupOrphanedObjects({
      db: fakeDb([], []),
      storage,
      now: NOW,
      mode: "dry-run",
      graceDays: 14,
    });
    expect(all.listed).toBe(2500);
    expect(all.truncated).toBe(false);
    const capped = await cleanupOrphanedObjects({
      db: fakeDb([], []),
      storage,
      now: NOW,
      mode: "dry-run",
      graceDays: 14,
      maxListed: 1000,
    });
    expect(capped.truncated).toBe(true);
    expect(capped.listed).toBeLessThan(2500);
  });
});

describe("GET /api/cron/orphan-cleanup", () => {
  const SECRET = "orphan-cron-secret-0123456789abcdef";
  const request = (auth?: string) =>
    new Request("http://localhost/api/cron/orphan-cleanup", {
      headers: auth ? { authorization: auth } : {},
    });

  it("needs the bearer secret and fails closed without one", async () => {
    const run = vi.fn();
    expect((await handleOrphanCleanupCron(request(), { secret: SECRET, run })).status).toBe(401);
    expect(
      (await handleOrphanCleanupCron(request("Bearer nope"), { secret: SECRET, run })).status,
    ).toBe(401);
    expect(
      (await handleOrphanCleanupCron(request(`Bearer ${SECRET}`), { secret: undefined, run }))
        .status,
    ).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it("returns the report; a failing storage listing gives 503 and deletes nothing", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const report = { mode: "dry-run", orphans: 2, failed: 0 };
    const ok = await handleOrphanCleanupCron(request(`Bearer ${SECRET}`), {
      secret: SECRET,
      run: async () => report as never,
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ status: "ok", orphans: 2 });
    const bad = await handleOrphanCleanupCron(request(`Bearer ${SECRET}`), {
      secret: SECRET,
      run: async () => {
        throw new Error("R2 down");
      },
    });
    expect(bad.status).toBe(503);
    expect(await bad.json()).toEqual({ status: "error" });
  });
});
