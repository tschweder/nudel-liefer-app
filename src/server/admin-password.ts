import { z } from "zod";

import type { PrismaClient } from "@/generated/prisma/client";

import { hashSecret } from "./auth/password";

/** Same rule as creating an admin in the admin area (`createAdminSchema`). */
export const ADMIN_PASSWORD_MIN = 10;
export const ADMIN_PASSWORD_MAX = 200;

const emailSchema = z.string().trim().min(3).max(200);
const passwordSchema = z.string().min(ADMIN_PASSWORD_MIN).max(ADMIN_PASSWORD_MAX);

type Db = Pick<PrismaClient, "user" | "loginAttempt">;

export type ResetAdminPasswordResult =
  | { ok: true; id: string; reactivated: boolean }
  | {
      ok: false;
      error: "invalid_input" | "weak_password" | "not_found" | "ambiguous" | "inactive";
    };

/**
 * Sets a new password for an ADMIN account (NUD-094, `pnpm admin:reset-password`; the office
 * cannot do this for itself when nobody can log in). Only admins qualify - driver PINs are reset in
 * the admin area. Also clears the login lock-out counter of that account, so the new password is
 * usable at once. An existing session stays valid until it expires or `AUTH_SECRET` is rotated
 * (docs/runbook.md). Never logs or returns the password.
 */
export async function resetAdminPassword(
  db: Db,
  input: { email: unknown; password: unknown; reactivate?: boolean },
): Promise<ResetAdminPasswordResult> {
  const email = emailSchema.safeParse(input.email);
  if (!email.success) return { ok: false, error: "invalid_input" };
  const password = passwordSchema.safeParse(input.password);
  if (!password.success) return { ok: false, error: "weak_password" };

  const matches = await db.user.findMany({
    where: { role: "ADMIN", email: { equals: email.data, mode: "insensitive" } },
    select: { id: true, active: true },
    take: 2,
  });
  if (matches.length === 0) return { ok: false, error: "not_found" };
  if (matches.length > 1) return { ok: false, error: "ambiguous" };
  const admin = matches[0]!;
  if (!admin.active && !input.reactivate) return { ok: false, error: "inactive" };

  await db.user.update({
    where: { id: admin.id },
    data: {
      passwordHash: await hashSecret(password.data),
      ...(admin.active ? {} : { active: true }),
    },
  });
  // Same key as the login rate limiter (`user:admin:<identifier lower-cased>`).
  await db.loginAttempt.deleteMany({ where: { key: `user:admin:${email.data.toLowerCase()}` } });
  return { ok: true, id: admin.id, reactivated: !admin.active };
}
