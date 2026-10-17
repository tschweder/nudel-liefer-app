import { z } from "zod";

import type { PrismaClient } from "@/generated/prisma/client";
import { localeSchema, tagToDbLocale } from "@/lib/localized-text";

const inputSchema = z.object({ locale: localeSchema }).strict();

/**
 * Stores the driver's own language choice: `User.locale` + `localeChosen = true`.
 * Input is validated here; the caller has already checked the DRIVER role.
 */
export async function chooseDriverLocale(
  db: Pick<PrismaClient, "user">,
  userId: string,
  input: unknown,
) {
  const { locale } = inputSchema.parse({ locale: input });
  await db.user.update({
    where: { id: userId },
    data: { locale: tagToDbLocale(locale), localeChosen: true },
  });
  return locale;
}
