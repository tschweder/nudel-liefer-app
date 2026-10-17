import type { NextAuthConfig } from "next-auth";
import { encode } from "next-auth/jwt";

import { applyJwt, DRIVER_SESSION_SECONDS, sessionMaxAge } from "./session-token";

/**
 * Provider-free Auth.js config: safe to import from `src/proxy.ts` (no database access).
 * The Credentials providers live in `auth.ts`.
 */
export const authConfig = {
  // Behind Vercel / a reverse proxy the Host header is trusted (cookies are host-bound anyway).
  trustHost: true,
  providers: [],
  pages: { signIn: "/login" },
  // Cookie lifetime is the longest one (driver); the JWT itself expires per role (see `jwt.encode`).
  session: { strategy: "jwt", maxAge: DRIVER_SESSION_SECONDS },
  jwt: {
    encode: (params) => encode({ ...params, maxAge: sessionMaxAge(params.token?.role) }),
  },
  callbacks: {
    jwt: ({ token, user, trigger, session }) => applyJwt({ token, user, trigger, session }),
    session: ({ session, token }) => {
      session.user.id = token.sub ?? "";
      session.user.role = token.role ?? "DRIVER";
      session.user.locale = token.locale ?? "de";
      return session;
    },
  },
} satisfies NextAuthConfig;
