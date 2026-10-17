import { createHash, timingSafeEqual } from "node:crypto";

const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * Vercel Cron calls the path with `Authorization: Bearer $CRON_SECRET` (the variable is sent
 * automatically when it is set in the project). Fails closed: no secret configured = nobody is
 * authorized. Compared in constant time.
 */
export function isCronAuthorized(
  authorization: string | null,
  secret: string | undefined,
): boolean {
  const expected = secret?.trim();
  if (!expected) return false;
  const match = /^Bearer (.+)$/.exec(authorization ?? "");
  if (!match) return false;
  return timingSafeEqual(digest(match[1]!), digest(expected));
}
