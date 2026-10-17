import { type NextRequest, NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";

import { isAppLocale, LOCALE_COOKIE, resolveLocale } from "@/lib/locale-resolution";

import { routing } from "./i18n/routing";

const handleI18n = createMiddleware(routing);

export default function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const firstSegment = pathname.split("/")[1] ?? "";

  if (!isAppLocale(firstSegment)) {
    // No (valid) locale prefix: redirect to the best match.
    // userLocale: the logged-in user's saved locale is wired in by NUD-004 (no sessions yet).
    const locale = resolveLocale({
      userLocale: null,
      cookie: request.cookies.get(LOCALE_COOKIE)?.value,
      acceptLanguage: request.headers.get("accept-language"),
    });
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}${pathname === "/" ? "" : pathname}`;
    url.search = search;
    return NextResponse.redirect(url);
  }
  return handleI18n(request);
}

export const config = {
  // Everything except API routes, Next internals and files with an extension.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
