import { z } from "zod";

import { type Theme, THEME_COOKIE, THEMES } from "@/lib/theme";

export type PersistThemeDeps = {
  setCookie: (name: string, value: string) => Promise<void> | void;
};

/**
 * Stores the chosen colour scheme in the cookie the layout reads. The value is validated on the
 * server (never trust the client) and there is deliberately nothing else to persist: the theme is a
 * device preference like the locale cookie, not a user record.
 */
export async function persistTheme(input: unknown, deps: PersistThemeDeps): Promise<Theme> {
  const theme = z.object({ theme: z.enum(THEMES) }).parse({ theme: input }).theme;
  await deps.setCookie(THEME_COOKIE, theme);
  return theme;
}
