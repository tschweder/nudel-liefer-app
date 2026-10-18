import { redirect } from "next/navigation";
import { connection } from "next/server";

import { type Actor, AuthorizationError, requireRole } from "./guards";

/** Path (with locale prefix) of the full-screen first-start language picker (NUD-050). */
export const driverStartPath = (locale: string) => `/${locale}/driver/start`;

/** A DRIVER who has not chosen a language yet must see the picker before anything else. */
export function needsLanguagePicker(actor: Pick<Actor, "role" | "localeChosen">): boolean {
  return actor.role === "DRIVER" && !actor.localeChosen;
}

/**
 * Page-level (defence in depth) check behind the proxy: returns the actor or redirects.
 * `admin` section: ADMIN only. `driver` section: DRIVER, and ADMIN for support views.
 * In the `driver` section a driver with `localeChosen = false` is sent to the language picker
 * (guard-level, so deep links cannot skip it); the picker page itself passes `allowUnchosen`.
 */
export async function requirePageActor(
  section: "admin" | "driver",
  locale: string,
  options: { allowUnchosen?: boolean } = {},
): Promise<Actor> {
  // NUD-097: the session is request data. Without this explicit dynamic access Next's
  // partial-prefetch validation renders the guard with an empty cookie jar, so Auth.js generates a
  // fresh CSRF token (`crypto.getRandomValues()`) while prerendering and logs a blocking error.
  await connection();
  let actor: Actor;
  try {
    actor = await requireRole(
      ...(section === "admin" ? (["ADMIN"] as const) : (["ADMIN", "DRIVER"] as const)),
    );
  } catch (error) {
    if (!(error instanceof AuthorizationError)) throw error;
    if (error.code === "FORBIDDEN") redirect(`/${locale}/driver`);
    // Unknown / deactivated user: end the session (clears the cookie) instead of linking to the
    // login page directly, which the proxy would bounce back while the JWT is still valid.
    redirect(`/api/session-ended?locale=${encodeURIComponent(locale)}&section=${section}`);
  }
  if (section === "driver" && !options.allowUnchosen && needsLanguagePicker(actor)) {
    redirect(driverStartPath(locale));
  }
  return actor;
}
