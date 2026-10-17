"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { LOCALE_COOKIE } from "@/lib/locale-resolution";

import { updateSession } from "./auth/auth";
import { requireRole } from "./auth/guards";
import { getDb } from "./db";
import { chooseDriverLocale } from "./driver-locale";

/** First-start language picker (NUD-050): saves the choice, then opens the driver home. */
export async function chooseDriverLocaleAction(locale: string): Promise<void> {
  const actor = await requireRole("DRIVER");
  const chosen = await chooseDriverLocale(getDb(), actor.id, locale);
  (await cookies()).set(LOCALE_COOKIE, chosen, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  await updateSession({ user: { locale: chosen } });
  redirect(`/${chosen}/driver`);
}
