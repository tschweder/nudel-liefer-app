/**
 * Colour scheme (NUD-132). The choice lives in a cookie so the server can render the class before the
 * first paint - an OS preference (the old `prefers-color-scheme` block) gave a dark-appearing app on
 * tablets whose system is dark, with no way back to the bright design.
 *
 * The checks below are hand-written rather than zod so this module stays dependency-free: the service
 * worker, the offline shell and the build scripts import these constants, and zod must not be pulled
 * into those bundles. `src/server/theme.ts` validates the cookie value with zod on the server.
 */
export const THEME_COOKIE = "NEXT_THEME";

export const THEMES = ["light", "dark"] as const;

export type Theme = (typeof THEMES)[number];

/**
 * Light is the default: this ticket was asked for as "make the design brighter", and light is the
 * scheme the redesign describes (re-design.md §4.1). Dark stays one tap away.
 */
export const DEFAULT_THEME: Theme = "light";

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

/** Cookie value to a usable theme; anything unknown (or absent) falls back to the default. */
export function resolveTheme(value: string | null | undefined): Theme {
  return isTheme(value) ? value : DEFAULT_THEME;
}

export function otherTheme(theme: Theme): Theme {
  return theme === "dark" ? "light" : "dark";
}
