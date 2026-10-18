import type { PrismaClient } from "@/generated/prisma/client";

export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
/** Failed attempts allowed per identifier (username / email) within the window. */
export const MAX_FAILURES_PER_USER = 5;
/** Failed attempts allowed per IP within the window (higher: offices/NAT share an address). */
export const MAX_FAILURES_PER_IP = 20;

export type RateLimitKey = { key: string; limit: number };

export function loginKeys(kind: "admin" | "driver", identifier: string, ip: string | null) {
  const keys: RateLimitKey[] = [
    {
      key: `user:${kind}:${identifier.trim().toLowerCase().slice(0, 100)}`,
      limit: MAX_FAILURES_PER_USER,
    },
  ];
  if (ip) keys.push({ key: `ip:${ip.slice(0, 64)}`, limit: MAX_FAILURES_PER_IP });
  return keys;
}

type Db = Pick<PrismaClient, "loginAttempt">;

/** True when any key already has `limit` failures inside the window. */
export async function isRateLimited(db: Db, keys: RateLimitKey[], now = new Date()) {
  const since = new Date(now.getTime() - LOGIN_WINDOW_MS);
  for (const { key, limit } of keys) {
    const count = await db.loginAttempt.count({ where: { key, createdAt: { gt: since } } });
    if (count >= limit) return true;
  }
  return false;
}

export async function recordFailure(db: Db, keys: RateLimitKey[], now = new Date()) {
  await db.loginAttempt.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - LOGIN_WINDOW_MS) } },
  });
  await db.loginAttempt.createMany({
    data: keys.map(({ key }) => ({ key, createdAt: now })),
  });
}

/** After a successful login the user's own counter is reset (the IP counter is kept). */
export async function clearFailures(db: Db, keys: RateLimitKey[]) {
  await db.loginAttempt.deleteMany({
    where: { key: { in: keys.filter((k) => k.key.startsWith("user:")).map((k) => k.key) } },
  });
}

/** Failed-login rows (user name + IP address) are useless after the 15 minute window; kept 24 h at most. */
export const LOGIN_ATTEMPT_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * Housekeeping for the daily retention cron (NUD-093): `recordFailure` only cleans up when another
 * failure happens, so without this the last failed attempts of a quiet period (with the IP address)
 * would stay in the table indefinitely.
 */
export async function purgeLoginAttempts(db: Db, now = new Date()): Promise<number> {
  const { count } = await db.loginAttempt.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - LOGIN_ATTEMPT_RETENTION_MS) } },
  });
  return count;
}
