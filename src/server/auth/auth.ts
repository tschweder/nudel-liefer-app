import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { getDb } from "../db";
import { authConfig } from "./auth.config";
import { authenticate, type LoginKind } from "./authenticate";

/** Thrown from `authorize`; surfaces as `code=rate_limited` in the sign-in result URL. */
export class RateLimitedError extends CredentialsSignin {
  code = "rate_limited";
}

function clientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || null;
}

function provider(kind: LoginKind) {
  const idField = kind === "admin" ? "email" : "username";
  const secretField = kind === "admin" ? "password" : "pin";
  return Credentials({
    id: kind,
    credentials: { [idField]: {}, [secretField]: {} },
    authorize: async (credentials, request) => {
      const result = await authenticate({
        db: getDb(),
        kind,
        identifier: credentials?.[idField],
        secret: credentials?.[secretField],
        ip: clientIp(request),
      });
      if (!result.ok) {
        if (result.reason === "rate_limited") throw new RateLimitedError();
        return null;
      }
      return {
        id: result.user.id,
        name: result.user.name,
        role: result.user.role,
        locale: result.user.locale,
      };
    },
  });
}

export const {
  handlers,
  auth,
  signIn,
  signOut,
  unstable_update: updateSession,
} = NextAuth({ ...authConfig, providers: [provider("admin"), provider("driver")] });
