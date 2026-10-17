import { z } from "zod";

import type { PrismaClient } from "@/generated/prisma/client";
import { dbLocaleToTag } from "@/lib/localized-text";

import { DUMMY_HASH, verifySecret } from "./password";
import { clearFailures, isRateLimited, loginKeys, recordFailure } from "./rate-limit";

export type LoginKind = "admin" | "driver";

const adminSchema = z.object({
  identifier: z.string().trim().min(1).max(254),
  secret: z.string().min(1).max(200),
});
const driverSchema = z.object({
  identifier: z.string().trim().min(1).max(64),
  secret: z.string().regex(/^\d{6}$/),
});

export type AuthenticatedUser = {
  id: string;
  role: "ADMIN" | "DRIVER";
  locale: ReturnType<typeof dbLocaleToTag>;
  name: string;
};

export type AuthResult =
  { ok: true; user: AuthenticatedUser } | { ok: false; reason: "invalid" | "rate_limited" };

type Db = Pick<PrismaClient, "user" | "loginAttempt">;

/**
 * Verifies admin (email + password) or driver (username + 6-digit PIN) credentials.
 * Rate limited (see rate-limit.ts); inactive users and wrong-role accounts are rejected
 * with the same "invalid" result as wrong credentials so nothing leaks.
 */
export async function authenticate(input: {
  db: Db;
  kind: LoginKind;
  identifier: unknown;
  secret: unknown;
  ip: string | null;
  now?: Date;
}): Promise<AuthResult> {
  const { db, kind, ip } = input;
  const now = input.now ?? new Date();
  const rawId = typeof input.identifier === "string" ? input.identifier : "";
  const keys = loginKeys(kind, rawId, ip);

  if (await isRateLimited(db, keys, now)) return { ok: false, reason: "rate_limited" };

  const parsed = (kind === "admin" ? adminSchema : driverSchema).safeParse({
    identifier: input.identifier,
    secret: input.secret,
  });
  const user = parsed.success
    ? await db.user.findFirst({
        where:
          kind === "admin"
            ? { role: "ADMIN", email: { equals: parsed.data.identifier, mode: "insensitive" } }
            : { role: "DRIVER", username: { equals: parsed.data.identifier, mode: "insensitive" } },
      })
    : null;

  // Always run one bcrypt comparison so timing does not reveal whether the user exists.
  const matches = await verifySecret(
    parsed.success ? parsed.data.secret : "invalid",
    user?.passwordHash ?? DUMMY_HASH,
  );

  if (!user || !user.active || !matches) {
    await recordFailure(db, keys, now);
    return { ok: false, reason: "invalid" };
  }
  await clearFailures(db, keys);
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: now } });
  return {
    ok: true,
    user: {
      id: user.id,
      role: user.role,
      locale: dbLocaleToTag(user.locale),
      name: user.displayName,
    },
  };
}
