import { type NextRequest, NextResponse } from "next/server";

import { SESSION_COOKIE_NAMES, sessionEndedTarget } from "@/server/auth/session-ended";

/**
 * Ends a session the server no longer accepts (user deactivated or deleted): pages cannot delete
 * cookies, so `requirePageActor` redirects here. Without this the proxy would still see a valid
 * JWT and bounce the user between the login page and the app.
 */
export function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const target = sessionEndedTarget(searchParams.get("locale"), searchParams.get("section"));
  if (!target) return new NextResponse(null, { status: 400 });
  const response = NextResponse.redirect(new URL(target, request.url));
  response.headers.set("Cache-Control", "no-store");
  for (const name of SESSION_COOKIE_NAMES) {
    response.cookies.set(name, "", {
      path: "/",
      maxAge: 0,
      secure: name.startsWith("__Secure-"),
      httpOnly: true,
      sameSite: "lax",
    });
  }
  return response;
}
