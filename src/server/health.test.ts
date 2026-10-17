// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { runHealthChecks } from "./health";
import { FakeStorage } from "./storage/fake";
import type { Storage } from "./storage/types";

const base = {
  pingDatabase: async () => 1,
  storage: () => new FakeStorage() as Storage,
  storageConfigured: true,
  env: {},
};

describe("runHealthChecks", () => {
  it("is ok when database and storage answer", async () => {
    const report = await runHealthChecks(base);
    expect(report.status).toBe("ok");
    expect(report.checks.database.status).toBe("ok");
    expect(report.checks.storage).toMatchObject({ status: "ok", mode: "s3" });
  });

  it("reports the Fake storage as skipped, not ok", async () => {
    const report = await runHealthChecks({ ...base, storageConfigured: false });
    expect(report.status).toBe("ok");
    expect(report.checks.storage).toMatchObject({ status: "skipped", mode: "fake" });
  });

  it("fails when the database is unreachable and leaks no error details", async () => {
    const report = await runHealthChecks({
      ...base,
      pingDatabase: async () => {
        throw new Error("connect ECONNREFUSED postgres://user:secret@ep-host.neon.tech/db");
      },
    });
    expect(report.status).toBe("error");
    expect(report.checks.database.status).toBe("error");
    expect(JSON.stringify(report)).not.toMatch(/secret|neon|postgres|ECONNREFUSED/);
  });

  it("fails when the storage rejects (bad credentials / bucket)", async () => {
    const storage = new FakeStorage();
    storage.checkReachable = async () => {
      throw new Error("AccessDenied key AKIA123 bucket nudel");
    };
    const report = await runHealthChecks({ ...base, storage: () => storage });
    expect(report.status).toBe("error");
    expect(report.checks.storage.status).toBe("error");
    expect(JSON.stringify(report)).not.toMatch(/AKIA|AccessDenied|nudel/);
  });

  it("fails when the storage is not configured (getStorage throws in production)", async () => {
    const report = await runHealthChecks({
      ...base,
      storage: () => {
        throw new Error("Object storage is not configured (S3_BUCKET ...)");
      },
    });
    expect(report.status).toBe("error");
    expect(report.checks.storage).toMatchObject({ status: "error", mode: "unconfigured" });
  });

  it("times out a hanging dependency", async () => {
    vi.useFakeTimers();
    const pending = runHealthChecks({
      ...base,
      pingDatabase: () => new Promise(() => {}),
      timeoutMs: 50,
    });
    await vi.advanceTimersByTimeAsync(60);
    const report = await pending;
    vi.useRealTimers();
    expect(report.checks.database.status).toBe("error");
    expect(report.status).toBe("error");
  });

  it("exposes only the short release SHA and region from the environment", async () => {
    const report = await runHealthChecks({
      ...base,
      env: {
        VERCEL_GIT_COMMIT_SHA: "0123456789abcdef",
        VERCEL_REGION: "fra1",
        DATABASE_URL: "postgres://x:y@z/db",
        AUTH_SECRET: "topsecret",
      },
    });
    expect(report.release).toBe("0123456");
    expect(report.region).toBe("fra1");
    expect(JSON.stringify(report)).not.toMatch(/topsecret|postgres:/);
  });
});
