import { stripBasePath } from "./base-path";
import { isAppLocale } from "./locale-resolution";

export type AppRole = "ADMIN" | "DRIVER";

export const ADMIN_LOGIN = "/login";
export const DRIVER_LOGIN = "/driver/login";
/** Public shell the service worker serves for driver pages while offline (NUD-081, no personal data). */
export const DRIVER_OFFLINE_SHELL = "/driver/offline-shell";

export function homePathFor(role: AppRole): string {
  return role === "ADMIN" ? "/admin" : "/driver";
}

/**
 * Splits "/zh-Hans/admin/x" into `{ locale: "zh-Hans", rest: "/admin/x" }`; locale null if absent.
 *
 * The base path is removed first, so a pathname that still carries it (`/delivery-app/de/admin`, as
 * the browser and the service worker see it) is understood the same way: without this,
 * `delivery-app` would be read as the locale and every route would look locale-less. `rest` is then
 * always relative to the app root, what `decideAccess` and the callers expect. Middleware pathnames
 * arrive already stripped (Next removes the base path from `request.nextUrl.pathname`), which makes
 * the removal a no-op there.
 */
export function splitLocalePath(pathname: string): { locale: string | null; rest: string } {
  const path = stripBasePath(pathname);
  const [, first = "", ...others] = path.split("/");
  if (isAppLocale(first))
    return { locale: first, rest: others.length ? `/${others.join("/")}` : "" };
  return { locale: null, rest: path };
}

const isSection = (rest: string, base: string) => rest === base || rest.startsWith(`${base}/`);

export type AccessDecision =
  | { type: "allow" }
  /** Redirect to `to` (path without locale). `withCallback`: remember where the user wanted to go. */
  | { type: "redirect"; to: string; withCallback: boolean };

/**
 * Route access policy (locale prefix already removed).
 * - /admin/** : ADMIN only.
 * - /driver/** : DRIVER, and ADMIN (support, read-only views; mutations still use requireRole).
 * - login pages: only for logged-out visitors.
 */
export function decideAccess(rest: string, role: AppRole | null): AccessDecision {
  if (rest === ADMIN_LOGIN || rest === DRIVER_LOGIN) {
    return role
      ? { type: "redirect", to: homePathFor(role), withCallback: false }
      : { type: "allow" };
  }
  if (rest === DRIVER_OFFLINE_SHELL) return { type: "allow" };
  if (isSection(rest, "/admin")) {
    if (role === "ADMIN") return { type: "allow" };
    if (role === "DRIVER")
      return { type: "redirect", to: homePathFor("DRIVER"), withCallback: false };
    return { type: "redirect", to: ADMIN_LOGIN, withCallback: true };
  }
  if (isSection(rest, "/driver")) {
    if (role) return { type: "allow" };
    return { type: "redirect", to: DRIVER_LOGIN, withCallback: true };
  }
  return { type: "allow" };
}

/**
 * Where to send a user after login: the requested page (if it is a same-site path the role may
 * open) or the role's home, always under the user's own locale prefix.
 */
export function postLoginPath(input: {
  role: AppRole;
  locale: string;
  callbackUrl?: string | null;
}): string {
  const { role, locale, callbackUrl } = input;
  const fallback = `/${locale}${homePathFor(role)}`;
  if (!callbackUrl || !callbackUrl.startsWith("/") || callbackUrl.startsWith("//")) return fallback;
  if (callbackUrl.includes("\\") || /[\u0000-\u001f]/.test(callbackUrl)) return fallback;
  const pathOnly = callbackUrl.split(/[?#]/)[0] ?? "";
  const { locale: prefix, rest } = splitLocalePath(pathOnly);
  if (!prefix || rest === "" || rest === ADMIN_LOGIN || rest === DRIVER_LOGIN) return fallback;
  if (decideAccess(rest, role).type !== "allow") return fallback;
  const suffix = callbackUrl.slice(pathOnly.length);
  return `/${locale}${rest}${suffix}`;
}
