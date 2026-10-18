import { type NextRequest, NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";

import { decideAccess, splitLocalePath } from "@/lib/access";
import { parseScriptHashManifest, scriptHashesFor } from "@/lib/csp-script-hashes";
import { localeRedirectPath } from "@/lib/locale-redirect";
import { LOCALE_COOKIE } from "@/lib/locale-resolution";
import { cspHeader } from "@/lib/security-headers";
import { readProxySession } from "@/server/auth/proxy-session";

import { routing } from "./i18n/routing";

const handleI18n = createMiddleware(routing);

// NUD-110: hashes of the inline scripts of the prerendered shells, inlined at build time by
// next.config.ts (`env`). Parsed once per instance.
const scriptHashes = parseScriptHashManifest(process.env.CSP_SCRIPT_HASHES);
const isDevelopment = process.env.NODE_ENV !== "production";

/** 128 random bits, base64: unguessable and different for every response. */
function createNonce(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
}

/**
 * The CSP of every page (NUD-093 / NUD-110). Next.js reads the nonce from the CSP *request* header
 * while it renders and puts it on the inline scripts it streams; the same header goes out with the
 * response. Prerendered shells cannot carry a nonce and are allowed by hash. Not in development,
 * where `'unsafe-inline'` is needed and a nonce would switch it off.
 */
export default async function proxy(request: NextRequest) {
  const { locale } = splitLocalePath(request.nextUrl.pathname);
  const csp = cspHeader(process.env, {
    nonce: isDevelopment ? undefined : createNonce(),
    scriptHashes: isDevelopment ? [] : scriptHashesFor(scriptHashes, locale),
  });
  request.headers.set(csp.key, csp.value);
  const response = await route(request);
  response.headers.set(csp.key, csp.value);
  return response;
}

async function route(request: NextRequest): Promise<NextResponse> {
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
