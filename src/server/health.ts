import { getDb } from "./db";
import { getStorage } from "./storage";
import type { Storage } from "./storage/types";

export type CheckStatus = "ok" | "error" | "skipped";

export type HealthReport = {
  status: "ok" | "error";
  checks: {
    database: { status: CheckStatus; latencyMs?: number };
    storage: { status: CheckStatus; mode: "s3" | "fake" | "unconfigured"; latencyMs?: number };
  };
  /** Short git SHA of the deployment (Vercel), when known. */
  release?: string;
  /** Vercel region that served the request, when known. */
  region?: string;
};

export type HealthDeps = {
  /** Runs a trivial query; rejects when the database is unreachable. */
  pingDatabase: () => Promise<unknown>;
  storage: () => Storage;
  /** True when S3_* is configured (otherwise dev/test use the Fake). */
  storageConfigured: boolean;
  env: Record<string, string | undefined>;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 4000;

async function timed(run: () => Promise<unknown>, timeoutMs: number) {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      run(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      }),
    ]);
    return { ok: true as const, latencyMs: Date.now() - started };
  } catch {
    // Details (connection strings, hosts) must never reach the response; look at the server logs.
    return { ok: false as const, latencyMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reachability of the database and of the object storage. The report contains no secrets, no
 * hostnames and no error messages: it is public so that uptime monitors can call it.
 */
export async function runHealthChecks(deps: HealthDeps): Promise<HealthReport> {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const [db, storage] = await Promise.all([
    timed(() => deps.pingDatabase(), timeoutMs),
    (async () => {
      try {
        const instance = deps.storage();
        const result = await timed(() => instance.checkReachable(), timeoutMs);
        return { ...result, mode: deps.storageConfigured ? ("s3" as const) : ("fake" as const) };
      } catch {
        // getStorage() throws in production when the S3_* variables are missing.
        return { ok: false as const, latencyMs: 0, mode: "unconfigured" as const };
      }
    })(),
  ]);

  // Local dev / tests without S3: the Fake is always "reachable" and says so.
  const storageStatus: CheckStatus = !storage.ok
    ? "error"
    : storage.mode === "fake"
      ? "skipped"
      : "ok";
  const databaseStatus: CheckStatus = db.ok ? "ok" : "error";
  const healthy = databaseStatus !== "error" && storageStatus !== "error";

  return {
    status: healthy ? "ok" : "error",
    checks: {
      database: { status: databaseStatus, latencyMs: db.latencyMs },
      storage: { status: storageStatus, mode: storage.mode, latencyMs: storage.latencyMs },
    },
    release: deps.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || undefined,
    region: deps.env.VERCEL_REGION || undefined,
  };
}

/** Production wiring used by the route handler. */
export function runProductionHealthChecks(env: Record<string, string | undefined> = process.env) {
  return runHealthChecks({
    pingDatabase: () => getDb().$queryRaw`SELECT 1`,
    storage: () => getStorage(env),
    storageConfigured: Boolean(env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY),
    env,
  });
}
