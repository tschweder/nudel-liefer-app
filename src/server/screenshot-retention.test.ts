// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { purgeLoginAttempts } from "./auth/rate-limit";
import { handleRetentionCron } from "./retention-cron";
import {
  DEFAULT_SCREENSHOT_RETENTION_DAYS,
  purgeExpiredScreenshots,
  screenshotRetentionDays,
} from "./screenshot-retention";
import { FakeStorage } from "./storage/fake";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-18T03:00:00Z");

describe("screenshotRetentionDays", () => {
  it("defaults to 180 and accepts whole numbers of days", () => {
    expect(screenshotRetentionDays(undefined)).toBe(180);
    expect(screenshotRetentionDays("")).toBe(180);
    expect(screenshotRetentionDays("90")).toBe(90);
    expect(screenshotRetentionDays(" 365 ")).toBe(365);
  });
  it("falls back to the default for anything that could disable or empty the retention", () => {
    for (const bad of ["0", "-5", "1.5", "abc", "10000", "1e3", "NaN"]) {
      expect(screenshotRetentionDays(bad), bad).toBe(DEFAULT_SCREENSHOT_RETENTION_DAYS);
    }
  });
});

type Row = { id: string; storageKey: string; createdAt: Date };
function fakeDb(rows: Row[], options: { failDeleteFor?: string } = {}) {
  const db = {
    screenshot: {
      findMany: vi.fn(async (args: { where: { createdAt: { lt: Date } }; take: number }) =>
        rows
          .filter((r) => r.createdAt < args.where.createdAt.lt)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .slice(0, args.take),
      ),
      deleteMany: vi.fn(async (args: { where: { id: string } }) => {
        if (args.where.id === options.failDeleteFor) throw new Error("db down");
        const i = rows.findIndex((r) => r.id === args.where.id);
        if (i >= 0) rows.splice(i, 1);
        return { count: i >= 0 ? 1 : 0 };
      }),
    },
  };
  return db;
}

describe("purgeExpiredScreenshots", () => {
  it("deletes object and row of expired screenshots only", async () => {
    const storage = new FakeStorage();
    for (const key of ["screenshots/old.jpg", "screenshots/edge.jpg", "screenshots/new.jpg"]) {
      storage.put(key, new Uint8Array([1]), "image/jpeg");
    }
    const rows: Row[] = [
      {
        id: "old",
        storageKey: "screenshots/old.jpg",
        createdAt: new Date(NOW.getTime() - 181 * DAY),
      },
      // exactly 180 days old is still inside the retention period
      {
        id: "edge",
        storageKey: "screenshots/edge.jpg",
        createdAt: new Date(NOW.getTime() - 180 * DAY),
      },
      {
        id: "new",
        storageKey: "screenshots/new.jpg",
        createdAt: new Date(NOW.getTime() - 5 * DAY),
      },
    ];
    const report = await purgeExpiredScreenshots({ db: fakeDb(rows) as never, storage, now: NOW });
    expect(report).toMatchObject({
      retentionDays: 180,
      examined: 1,
      deleted: 1,
      failed: 0,
      more: false,
    });
    expect(rows.map((r) => r.id)).toEqual(["edge", "new"]);
    expect(storage.has("screenshots/old.jpg")).toBe(false);
    expect(storage.has("screenshots/edge.jpg")).toBe(true);
    expect(storage.has("screenshots/new.jpg")).toBe(true);
  });

  it("honours a configured retention period", async () => {
    const storage = new FakeStorage();
    const rows: Row[] = [
      { id: "a", storageKey: "screenshots/a.jpg", createdAt: new Date(NOW.getTime() - 40 * DAY) },
    ];
    const report = await purgeExpiredScreenshots({
      db: fakeDb(rows) as never,
      storage,
      now: NOW,
      retentionDays: 30,
    });
    expect(report.deleted).toBe(1);
    expect(report.retentionDays).toBe(30);
  });

  it("deletes the storage object before the row and keeps the row when storage fails", async () => {
    const order: string[] = [];
    const storage = new FakeStorage();
    const realDelete = storage.delete.bind(storage);
    storage.delete = async (key) => {
      order.push(`storage:${key}`);
      if (key.endsWith("bad.jpg")) throw new Error("R2 unavailable");
      await realDelete(key);
    };
    const rows: Row[] = [
      {
        id: "bad",
        storageKey: "screenshots/bad.jpg",
        createdAt: new Date(NOW.getTime() - 300 * DAY),
      },
      {
        id: "ok",
        storageKey: "screenshots/ok.jpg",
        createdAt: new Date(NOW.getTime() - 200 * DAY),
      },
    ];
    const db = fakeDb(rows);
    db.screenshot.deleteMany.mockImplementation(async (args) => {
      order.push(`row:${args.where.id}`);
      const i = rows.findIndex((r) => r.id === args.where.id);
      if (i >= 0) rows.splice(i, 1);
      return { count: 1 };
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const report = await purgeExpiredScreenshots({ db: db as never, storage, now: NOW });
    expect(report).toMatchObject({ examined: 2, deleted: 1, failed: 1 });
    expect(rows.map((r) => r.id)).toEqual(["bad"]); // retried by the next run
    expect(order).toEqual(["storage:screenshots/bad.jpg", "storage:screenshots/ok.jpg", "row:ok"]);
  });

  it("a failed row delete leaves a row without object, which the next run removes", async () => {
    const storage = new FakeStorage();
    storage.put("screenshots/x.jpg", new Uint8Array([1]), "image/jpeg");
    const rows: Row[] = [
      { id: "x", storageKey: "screenshots/x.jpg", createdAt: new Date(NOW.getTime() - 300 * DAY) },
    ];
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const first = await purgeExpiredScreenshots({
      db: fakeDb(rows, { failDeleteFor: "x" }) as never,
      storage,
      now: NOW,
    });
    expect(first).toMatchObject({ deleted: 0, failed: 1 });
    expect(storage.has("screenshots/x.jpg")).toBe(false);
    expect(rows).toHaveLength(1);
    const second = await purgeExpiredScreenshots({ db: fakeDb(rows) as never, storage, now: NOW });
    expect(second).toMatchObject({ deleted: 1, failed: 0 });
    expect(rows).toHaveLength(0);
  });

  it("works in batches and reports when more is left", async () => {
    const storage = new FakeStorage();
    const rows: Row[] = Array.from({ length: 5 }, (_, i) => ({
      id: `s${i}`,
      storageKey: `screenshots/${i}.jpg`,
      createdAt: new Date(NOW.getTime() - (400 - i) * DAY),
    }));
    const report = await purgeExpiredScreenshots({
      db: fakeDb(rows) as never,
      storage,
      now: NOW,
      batchSize: 3,
    });
    expect(report).toMatchObject({ examined: 3, deleted: 3, more: true });
    expect(rows).toHaveLength(2);
  });
});

describe("GET /api/cron/retention handler", () => {
  const SECRET = "purge-secret-for-tests";
  const req = (authorization?: string) =>
    new Request("http://localhost/api/cron/retention", {
      headers: authorization ? { authorization } : {},
    });

  it("rejects missing / wrong credentials without touching db or storage", async () => {
    const run = vi.fn();
    const db = vi.fn();
    const storage = vi.fn();
    for (const header of [undefined, "Bearer wrong", SECRET]) {
      const res = await handleRetentionCron(req(header), {
        secret: SECRET,
        run: run as never,
        db: db as never,
        storage: storage as never,
      });
      expect(res.status).toBe(401);
    }
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const unset = await handleRetentionCron(req(`Bearer ${SECRET}`), {
      secret: undefined,
      run: run as never,
    });
    expect(unset.status).toBe(401);
    expect([run, db, storage].every((f) => f.mock.calls.length === 0)).toBe(true);
  });

  it("runs the purge for the right secret and reports the result", async () => {
    const report = {
      retentionDays: 180,
      cutoff: "x",
      examined: 2,
      deleted: 2,
      failed: 0,
      more: false,
    };
    const run = vi.fn(async () => report);
    const purgeLogins = vi.fn(async () => 3);
    const res = await handleRetentionCron(req(`Bearer ${SECRET}`), {
      secret: SECRET,
      run: run as never,
      purgeLogins: purgeLogins as never,
      db: (() => ({})) as never,
      storage: (() => new FakeStorage()) as never,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", ...report, loginAttemptsDeleted: 3 });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("reports a partial run", async () => {
    const run = vi.fn(async () => ({
      retentionDays: 180,
      cutoff: "x",
      examined: 2,
      deleted: 1,
      failed: 1,
      more: false,
    }));
    const res = await handleRetentionCron(req(`Bearer ${SECRET}`), {
      secret: SECRET,
      run: run as never,
      purgeLogins: (async () => 0) as never,
      db: (() => ({})) as never,
      storage: (() => new FakeStorage()) as never,
    });
    expect((await res.json()).status).toBe("partial");
  });
});

describe("purgeLoginAttempts", () => {
  it("deletes failed-login rows older than 24 hours and returns the count", async () => {
    const deleteMany = vi.fn(async () => ({ count: 4 }));
    const count = await purgeLoginAttempts({ loginAttempt: { deleteMany } } as never, NOW);
    expect(count).toBe(4);
    const cutoff = (
      deleteMany.mock.calls[0] as unknown as [{ where: { createdAt: { lt: Date } } }]
    )[0].where.createdAt.lt;
    expect(cutoff.toISOString()).toBe("2026-10-17T03:00:00.000Z");
  });
});
