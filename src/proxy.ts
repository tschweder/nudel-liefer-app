import { type NextRequest, NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";

import { decideAccess, splitLocalePath } from "@/lib/access";
import { localeRedirectPath } from "@/lib/locale-redirect";
import { LOCALE_COOKIE } from "@/lib/locale-resolution";
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
    // This is also the target of the installed app's start URL `/driver?source=pwa` (NUD-106):
    // the answer depends on the session / cookie, so it must never be cached or stored.
    const target = localeRedirectPath({
      pathname,
      search,
      userLocale: user?.locale,
      cookie: request.cookies.get(LOCALE_COOKIE)?.value,
      acceptLanguage: request.headers.get("accept-language"),
    });
    const redirect = NextResponse.redirect(new URL(target, request.url));
    redirect.headers.set("Cache-Control", "no-store");
    redirect.headers.append("Vary", "Cookie, Accept-Language");
    return redirect;
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
