import { redirect } from "next/navigation";

import { type Actor, AuthorizationError, requireRole } from "./guards";

/**
 * Page-level (defence in depth) check behind the proxy: returns the actor or redirects.
 * `admin` section: ADMIN only. `driver` section: DRIVER, and ADMIN for support views.
 */
export async function requirePageActor(
  section: "admin" | "driver",
  locale: string,
): Promise<Actor> {
  try {
    return await requireRole(
      ...(section === "admin" ? (["ADMIN"] as const) : (["ADMIN", "DRIVER"] as const)),
    );
  } catch (error) {
    if (!(error instanceof AuthorizationError)) throw error;
    if (error.code === "FORBIDDEN") redirect(`/${locale}/driver`);
    // Unknown / deactivated user: end the session (clears the cookie) instead of linking to the
    // login page directly, which the proxy would bounce back while the JWT is still valid.
    redirect(`/api/session-ended?locale=${encodeURIComponent(locale)}&section=${section}`);
  }
}
