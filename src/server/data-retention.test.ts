// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import {
  DATA_RETENTION_MAX_BATCHES,
  dataRetentionMode,
  DEFAULT_DRIVER_TEXT_RETENTION_DAYS,
  driverTextRetentionDays,
  MIN_DRIVER_TEXT_RETENTION_DAYS,
  scrubExpiredDriverTexts,
} from "./data-retention";
import { handleDataRetentionCron } from "./data-retention-cron";

const NOW = new Date("2026-10-18T03:00:00Z");

/** Fake stop table: `left` expired rows; `updateMany` removes the ids it is given. */
function fakeDb(rows: number) {
  let left = rows;
  const stop = {
    count: vi.fn(async () => left),
    findMany: vi.fn(async (args: { take: number }) =>
      Array.from({ length: Math.min(left, args.take) }, (_, i) => ({ id: `s${i}` })),
    ),
    updateMany: vi.fn(async (args: { where: { id: { in: string[] } } }) => {
      left -= args.where.id.in.length;
      return { count: args.where.id.in.length };
    }),
  };
  return { db: { stop }, stop, remaining: () => left };
}

describe("env parsing", () => {
  it("mode defaults to dry-run for unset and unknown values", () => {
    expect(dataRetentionMode(undefined)).toBe("dry-run");
    expect(dataRetentionMode("")).toBe("dry-run");
    expect(dataRetentionMode("DELETE ")).toBe("delete");
    expect(dataRetentionMode("off")).toBe("off");
    expect(dataRetentionMode("yes")).toBe("dry-run");
    expect(dataRetentionMode("true")).toBe("dry-run");
  });
  it("period defaults to 365 and falls back for typos and out-of-range values", () => {
    expect(driverTextRetentionDays(undefined)).toBe(365);
    expect(driverTextRetentionDays(" 730 ")).toBe(730);
    expect(driverTextRetentionDays("30")).toBe(30);
    for (const bad of ["0", "1", "29", "-1", "1.5", "abc", "1e3", "3651", ""]) {
      expect(driverTextRetentionDays(bad), bad).toBe(DEFAULT_DRIVER_TEXT_RETENTION_DAYS);
    }
  });
});

describe("scrubExpiredDriverTexts", () => {
  it("refuses a period below the floor instead of clamping", async () => {
    const { db, stop } = fakeDb(3);
    await expect(
      scrubExpiredDriverTexts({
        db: db as never,
        mode: "delete",
        retentionDays: MIN_DRIVER_TEXT_RETENTION_DAYS - 1,
      }),
    ).rejects.toThrow(/refused/);
    expect(stop.updateMany).not.toHaveBeenCalled();
  });

  it("dry-run counts and changes nothing", async () => {
    const { db, stop, remaining } = fakeDb(7);
    const report = await scrubExpiredDriverTexts({
      db: db as never,
      now: NOW,
      mode: "dry-run",
      retentionDays: 365,
    });
    expect(report).toMatchObject({ mode: "dry-run", expired: 7, scrubbed: 0, batches: 0 });
    expect(report.cutoff).toBe("2025-10-18T03:00:00.000Z");
    expect(stop.updateMany).not.toHaveBeenCalled();
    expect(remaining()).toBe(7);
  });

  it("off does not even read", async () => {
    const { db, stop } = fakeDb(7);
    const report = await scrubExpiredDriverTexts({ db: db as never, mode: "off" });
    expect(report).toMatchObject({ expired: 0, scrubbed: 0 });
    expect(stop.count).not.toHaveBeenCalled();
    expect(stop.findMany).not.toHaveBeenCalled();
  });

  it("delete works in batches and reports counts", async () => {
    const { db, stop, remaining } = fakeDb(1100);
    const report = await scrubExpiredDriverTexts({
      db: db as never,
      mode: "delete",
      batchSize: 500,
    });
    expect(report).toMatchObject({ scrubbed: 1100, batches: 3, more: false });
    expect(stop.updateMany).toHaveBeenCalledTimes(3);
    expect(remaining()).toBe(0);
  });

  it("stops after the batch limit and reports that more remain", async () => {
    const { db, remaining } = fakeDb(10 * 500);
    const report = await scrubExpiredDriverTexts({
      db: db as never,
      mode: "delete",
      batchSize: 500,
      maxBatches: 3,
    });
    expect(report).toMatchObject({ scrubbed: 1500, batches: 3, more: true });
    expect(remaining()).toBe(3500);
    expect(DATA_RETENTION_MAX_BATCHES).toBeGreaterThan(3);
  });
});

describe("handleDataRetentionCron", () => {
  const report = {
    mode: "dry-run" as const,
    retentionDays: 365,
    cutoff: "x",
    expired: 2,
    scrubbed: 0,
    batches: 0,
    more: false,
  };
  const req = (auth?: string) =>
    new Request("http://x/api/cron/data-retention", {
      headers: auth ? { authorization: auth } : {},
    });

  it("rejects without a configured secret and with a wrong one, and never runs", async () => {
    const run = vi.fn(async () => report);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      (await handleDataRetentionCron(req("Bearer a"), { secret: undefined, run })).status,
    ).toBe(401);
    expect((await handleDataRetentionCron(req("Bearer b"), { secret: "a", run })).status).toBe(401);
    expect((await handleDataRetentionCron(req(), { secret: "a", run })).status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it("runs with the secret, answers with counts only and logs one line", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const res = await handleDataRetentionCron(req("Bearer a"), {
      secret: "a",
      run: async () => report,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", ...report });
    expect(info).toHaveBeenCalledWith(expect.stringContaining("[data-retention]"));
  });

  it("answers 503 without leaking the message when the run fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await handleDataRetentionCron(req("Bearer a"), {
      secret: "a",
      run: async () => {
        throw new Error("secret detail");
      },
    });
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain("secret detail");
  });
});
