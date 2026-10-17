import { decode } from "next-auth/jwt";

const COOKIE_NAMES = ["__Secure-authjs.session-token", "authjs.session-token"];

export type ProxySession = { id: string; role: "ADMIN" | "DRIVER"; locale?: string } | null;

/**
 * Reads the session JWT from the request cookies without touching it. Used by the proxy instead of
 * the Auth.js `auth()` middleware wrapper, which re-issues the session cookie on every request and
 * would overwrite the cookie deletion done by a logout server action.
 * Expired or invalid tokens yield null (`decode` verifies signature and `exp`).
 */
export async function readProxySession(
  getCookie: (name: string) => string | undefined,
  secret = process.env.AUTH_SECRET,
): Promise<ProxySession> {
  if (!secret) return null;
  for (const name of COOKIE_NAMES) {
    const token = getCookie(name);
    if (!token) continue;
    try {
      const jwt = await decode({ token, secret, salt: name });
      if (jwt?.sub && (jwt.role === "ADMIN" || jwt.role === "DRIVER")) {
        return { id: jwt.sub, role: jwt.role, locale: jwt.locale };
      }
    } catch {
      // invalid token: treat as logged out
    }
  }
  return null;
}
