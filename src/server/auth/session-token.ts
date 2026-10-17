import type { JWT } from "next-auth/jwt";

import { isAppLocale } from "@/lib/locale-resolution";

export const ADMIN_SESSION_SECONDS = 12 * 60 * 60;
export const DRIVER_SESSION_SECONDS = 90 * 24 * 60 * 60;

export function sessionMaxAge(role: unknown): number {
  return role === "ADMIN" ? ADMIN_SESSION_SECONDS : DRIVER_SESSION_SECONDS;
}

type LoginUser = { id?: string; role?: "ADMIN" | "DRIVER"; locale?: string; name?: string | null };

/** Auth.js `jwt` callback: copy identity on sign-in, apply locale updates (`update({ user: { locale } })`). */
export function applyJwt(input: {
  token: JWT;
  user?: LoginUser | null;
  trigger?: "signIn" | "signUp" | "update";
  session?: unknown;
}): JWT {
  const { token, user, trigger, session } = input;
  if (user?.id) {
    token.sub = user.id;
    token.role = user.role;
    token.locale = user.locale;
    token.name = user.name ?? undefined;
  }
  if (trigger === "update" && session && typeof session === "object") {
    const next = (session as { user?: { locale?: unknown } }).user?.locale;
    if (isAppLocale(next)) token.locale = next;
  }
  return token;
}
