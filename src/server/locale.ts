import { z } from "zod";

import { LOCALE_COOKIE } from "@/lib/locale-resolution";
import { localeSchema, tagToDbLocale } from "@/lib/localized-text";

export type PersistLocaleDeps = {
  getUserId: () => Promise<string | null>;
  setCookie: (name: string, value: string) => Promise<void> | void;
  updateUserLocale: (userId: string, dbLocale: ReturnType<typeof tagToDbLocale>) => Promise<void>;
};

/**
 * Persists the chosen locale: always in the NEXT_LOCALE cookie, and on `User.locale`
 * when someone is logged in. The locale is validated on the server (never trust the client).
 */
export async function persistLocale(input: unknown, deps: PersistLocaleDeps): Promise<void> {
  const locale = z.object({ locale: localeSchema }).parse({ locale: input }).locale;
  await deps.setCookie(LOCALE_COOKIE, locale);
  const userId = await deps.getUserId();
  if (userId) await deps.updateUserLocale(userId, tagToDbLocale(locale));
}
