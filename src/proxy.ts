import { type NextRequest, NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";

import { decideAccess, splitLocalePath } from "@/lib/access";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/locale-resolution";
import { readProxySession } from "@/server/auth/proxy-session";

import { routing } from "./i18n/routing";

const handleI18n = createMiddleware(routing);
export default async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  // Read-only JWT check (no database access, no cookie refresh); pages/actions re-check via requireRole.
  const user = await readProxySession((name) => request.cookies.get(name)?.value);
  const role = user?.role ?? null;
  const { locale, rest } = splitLocalePath(pathname);

  if (!locale) {
    // No (valid) locale prefix: user's locale -> cookie -> Accept-Language -> de.
    const best = resolveLocale({
      userLocale: user?.locale,
      cookie: request.cookies.get(LOCALE_COOKIE)?.value,
      acceptLanguage: request.headers.get("accept-language"),
    });
    const url = request.nextUrl.clone();
    url.pathname = `/${best}${pathname === "/" ? "" : pathname}`;
    url.search = search;
    return NextResponse.redirect(url);
  }

  const decision = decideAccess(rest, role);
  if (decision.type === "redirect") {
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}${decision.to}`;
    url.search = "";
    if (decision.withCallback) url.searchParams.set("callbackUrl", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }
  return handleI18n(request);
}

export const config = {
  // Everything except API routes, Next internals and files with an extension.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
