import { isAppLocale } from "@/lib/locale-resolution";

export const SESSION_COOKIE_NAMES = ["__Secure-authjs.session-token", "authjs.session-token"];

/**
 * Where to send a visitor whose session is no longer valid (e.g. a deactivated driver) after the
 * session cookie was removed. Returns null for invalid parameters.
 */
export function sessionEndedTarget(locale: unknown, section: unknown): string | null {
  if (!isAppLocale(locale)) return null;
  if (section === "admin") return `/${locale}/login`;
  if (section === "driver") return `/${locale}/driver/login`;
  return null;
}
