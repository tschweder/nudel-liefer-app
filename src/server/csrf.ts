/**
 * Origin check for state-changing route handlers (NUD-093). Server actions already get Next.js'
 * own Origin/Host comparison; route handlers do not, so `/api/uploads`, `/api/driver/sync`,
 * `/api/driver/photos` and the import parser call this after the role check.
 *
 * Layers against cross-site request forgery, in order of strength:
 * 1. session cookies are `SameSite=Lax` (not sent on cross-site POSTs),
 * 2. the handlers want `application/json` / multipart bodies and a role (cookie) check,
 * 3. this check: a browser always sends `Origin` on a POST, and `Sec-Fetch-Site` on every request.
 *
 * A request carrying neither header does not come from a browser, so it cannot be a cross-site
 * forgery of a logged-in browser session (it would need the cookie anyway) and is let through.
 */
export function isSameOriginRequest(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return false;

  const origin = request.headers.get("origin");
  if (origin === null) return true;
  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return false; // "null" (sandboxed iframe, redirect chain) or garbage
  }
  const forwarded = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = (
    forwarded ||
    request.headers.get("host") ||
    new URL(request.url).host
  ).toLowerCase();
  return originHost === host;
}

/** `403 { error: "bad_origin" }` for a cross-site request, `null` when the request may go on. */
export function rejectCrossOrigin(request: Request): Response | null {
  if (isSameOriginRequest(request)) return null;
  return Response.json(
    { error: "bad_origin" },
    { status: 403, headers: { "Cache-Control": "private, no-store" } },
  );
}
