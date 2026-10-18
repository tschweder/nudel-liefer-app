// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import {
  AUDIT_PURGE_MAX_BATCHES,
  auditRetentionDays,
  DEFAULT_AUDIT_RETENTION_DAYS,
  MIN_AUDIT_RETENTION_DAYS,
  purgeExpiredAuditEntries,
} from "./audit-retention";
import { handleAuditRetentionCron } from "./audit-retention-cron";

const NOW = new Date("2026-10-18T03:00:00Z");

/** Fake database: each transaction deletes up to `limit` of the remaining rows. */
function fakeDb(rows: number) {
  const log: string[] = [];
  let left = rows;
  const db = {
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<number>) => {
      const tx = {
        // Tagged-template call (set_config) and Prisma.sql call (the DELETE) look different.
        $executeRaw: vi.fn(async (query: unknown, ...values: unknown[]) => {
          if (Array.isArray(query)) {
            log.push("set");
            return 1;
          }
          const sql = query as { values: unknown[] };
          const limit = sql.values.at(-1) as number;
          log.push("delete");
          const n = Math.min(left, limit);
          left -= n;
          void values;
          return n;
        }),
      };
      return fn(tx);
    }),
  };
  return { db, log, remaining: () => left };
}

describe("auditRetentionDays", () => {
  it("defaults to 730 and accepts whole numbers from the floor up", () => {
    expect(auditRetentionDays(undefined)).toBe(730);
    expect(auditRetentionDays("")).toBe(730);
    expect(auditRetentionDays("90")).toBe(90);
    expect(auditRetentionDays(" 365 ")).toBe(365);
  });
  it("falls back to the default for typos and values below the floor", () => {
    for (const bad of ["0", "1", "89", "-5", "1.5", "abc", "1e3", "NaN", "99999"]) {
      expect(auditRetentionDays(bad), bad).toBe(DEFAULT_AUDIT_RETENTION_DAYS);
    }
  });
});

describe("purgeExpiredAuditEntries", () => {
  it("refuses a retention below the floor instead of clamping it", async () => {
    const { db } = fakeDb(5);
    await expect(
      purgeExpiredAuditEntries({ db: db as never, retentionDays: MIN_AUDIT_RETENTION_DAYS - 1 }),
    ).rejects.toThrow(/refused/);
    await expect(purgeExpiredAuditEntries({ db: db as never, retentionDays: 1.5 })).rejects.toThrow(
      /refused/,
    );
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("deletes in bounded batches, each in its own transaction, and reports the counts", async () => {
    const { db, log } = fakeDb(2500);
    const report = await purgeExpiredAuditEntries({
      db: db as never,
      now: NOW,
      retentionDays: 100,
      batchSize: 1000,
    });
    expect(report).toMatchObject({ deleted: 2500, batches: 3, more: false, retentionDays: 100 });
    expect(report.cutoff).toBe("2026-07-10T03:00:00.000Z");
    expect(db.$transaction).toHaveBeenCalledTimes(3);
    expect(log).toEqual(["set", "delete", "set", "delete", "set", "delete"]);
  });

  it("stops after the maximum number of batches and says there is more", async () => {
    const { db, remaining } = fakeDb(10_000);
    const report = await purgeExpiredAuditEntries({
      db: db as never,
      retentionDays: 365,
      batchSize: 10,
      maxBatches: 3,
    });
    expect(report).toMatchObject({ deleted: 30, batches: 3, more: true });
    expect(remaining()).toBe(9970);
    expect(AUDIT_PURGE_MAX_BATCHES).toBeGreaterThan(1);
  });

  it("does nothing (one empty batch) when nothing is old enough", async () => {
    const { db } = fakeDb(0);
    const report = await purgeExpiredAuditEntries({ db: db as never, retentionDays: 365 });
    expect(report).toMatchObject({ deleted: 0, batches: 1, more: false });
  });
});

describe("handleAuditRetentionCron", () => {
  const request = (auth?: string) =>
    new Request("http://localhost/api/cron/audit-retention", {
      headers: auth ? { authorization: auth } : {},
    });
  const report = {
    retentionDays: 730,
    cutoff: NOW.toISOString(),
    deleted: 7,
    batches: 1,
    more: false,
  };

  it("rejects a missing, wrong or unconfigured secret with 401 and runs nothing", async () => {
    const run = vi.fn();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    for (const [secret, auth] of [
      ["s3cret", undefined],
      ["s3cret", "Bearer nope"],
      [undefined, "Bearer s3cret"],
      ["  ", "Bearer "],
    ] as const) {
      const res = await handleAuditRetentionCron(request(auth), { secret, run });
      expect(res.status).toBe(401);
    }
    expect(run).not.toHaveBeenCalled();
  });

  it("answers 200 with the counts and logs one sanitized line", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const res = await handleAuditRetentionCron(request("Bearer s3cret"), {
      secret: "s3cret",
      run: async () => report,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ status: "ok", ...report });
    expect(info).toHaveBeenCalledTimes(1);
    expect(String(info.mock.calls[0]![0])).toBe(`[audit-retention] ${JSON.stringify(report)}`);
  });

  it("answers 503 without leaking the error when the run fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await handleAuditRetentionCron(request("Bearer s3cret"), {
      secret: "s3cret",
      run: async () => {
        throw new Error("connection to postgres://u:pw@host failed");
      },
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "error" });
    expect(error).toHaveBeenCalled();
  });
});
