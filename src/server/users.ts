import { randomInt } from "node:crypto";

import { z } from "zod";

import type { PrismaClient } from "@/generated/prisma/client";
import { type AppLocale, dbLocaleToTag, localeSchema, tagToDbLocale } from "@/lib/localized-text";

import { hashSecret } from "./auth/password";
import { clearFailures, loginKeys } from "./auth/rate-limit";

type Db = Pick<PrismaClient, "user" | "loginAttempt">;

export type UserError = "invalid" | "username_taken" | "email_taken" | "not_found" | "self";
export type Result<T> = ({ ok: true } & T) | { ok: false; error: UserError };

export const createDriverSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9._-]{2,31}$/),
  locale: localeSchema,
});

export const createAdminSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  password: z.string().min(10).max(200),
});

export const userIdSchema = z.string().trim().min(1).max(64);
export const activeSchema = z.boolean();

/** Random 6-digit PIN (leading zeros allowed), cryptographically secure. */
export function generatePin(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export type UserRow = {
  id: string;
  role: "ADMIN" | "DRIVER";
  displayName: string;
  username: string | null;
  email: string | null;
  locale: AppLocale;
  active: boolean;
  lastLoginAt: string | null;
};

const select = {
  id: true,
  role: true,
  displayName: true,
  username: true,
  email: true,
  locale: true,
  active: true,
  lastLoginAt: true,
} as const;

export async function listUsers(db: Pick<PrismaClient, "user">, role: "ADMIN" | "DRIVER") {
  const rows = await db.user.findMany({
    where: { role },
    select,
    orderBy: [{ active: "desc" }, { displayName: "asc" }],
  });
  return rows.map((u): UserRow => ({
    ...u,
    locale: dbLocaleToTag(u.locale),
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
  }));
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002"
  );
}

/** Creates a driver with a fresh PIN. The plain PIN is returned once and never stored. */
export async function createDriver(
  db: Db,
  input: unknown,
): Promise<Result<{ id: string; pin: string }>> {
  const parsed = createDriverSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { displayName, username, locale } = parsed.data;
  const taken = await db.user.findFirst({
    where: { username: { equals: username, mode: "insensitive" } },
    select: { id: true },
  });
  if (taken) return { ok: false, error: "username_taken" };
  const pin = generatePin();
  try {
    const user = await db.user.create({
      data: {
        role: "DRIVER",
        displayName,
        username,
        locale: tagToDbLocale(locale),
        passwordHash: await hashSecret(pin),
      },
    });
    return { ok: true, id: user.id, pin };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: "username_taken" };
    throw error;
  }
}

export async function createAdmin(db: Db, input: unknown): Promise<Result<{ id: string }>> {
  const parsed = createAdminSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { displayName, email, password } = parsed.data;
  const taken = await db.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true },
  });
  if (taken) return { ok: false, error: "email_taken" };
  try {
    const user = await db.user.create({
      data: { role: "ADMIN", displayName, email, passwordHash: await hashSecret(password) },
    });
    return { ok: true, id: user.id };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: "email_taken" };
    throw error;
  }
}

/** Replaces the PIN (the old hash is gone, so the old PIN stops working immediately). */
export async function resetDriverPin(db: Db, id: unknown): Promise<Result<{ pin: string }>> {
  const parsedId = userIdSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, error: "invalid" };
  const user = await db.user.findFirst({ where: { id: parsedId.data, role: "DRIVER" } });
  if (!user) return { ok: false, error: "not_found" };
  const pin = generatePin();
  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashSecret(pin) },
  });
  // A locked-out driver should be able to use the new PIN right away.
  if (user.username) await clearFailures(db, loginKeys("driver", user.username, null));
  return { ok: true, pin };
}

/** Deactivates / reactivates any user. Admins cannot deactivate themselves. */
export async function setUserActive(
  db: Db,
  actorId: string,
  id: unknown,
  active: unknown,
): Promise<Result<object>> {
  const parsedId = userIdSchema.safeParse(id);
  const parsedActive = activeSchema.safeParse(active);
  if (!parsedId.success || !parsedActive.success) return { ok: false, error: "invalid" };
  if (parsedId.data === actorId && !parsedActive.data) return { ok: false, error: "self" };
  const user = await db.user.findUnique({ where: { id: parsedId.data }, select: { id: true } });
  if (!user) return { ok: false, error: "not_found" };
  await db.user.update({ where: { id: user.id }, data: { active: parsedActive.data } });
  return { ok: true };
}

export async function setDriverLocale(
  db: Db,
  id: unknown,
  locale: unknown,
): Promise<Result<object>> {
  const parsedId = userIdSchema.safeParse(id);
  const parsedLocale = localeSchema.safeParse(locale);
  if (!parsedId.success || !parsedLocale.success) return { ok: false, error: "invalid" };
  const user = await db.user.findFirst({
    where: { id: parsedId.data, role: "DRIVER" },
    select: { id: true },
  });
  if (!user) return { ok: false, error: "not_found" };
  await db.user.update({
    where: { id: user.id },
    data: { locale: tagToDbLocale(parsedLocale.data) },
  });
  return { ok: true };
}
