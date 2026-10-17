"use server";

import { cookies } from "next/headers";

import { updateSession } from "./auth/auth";
import { getDb } from "./db";
import { persistLocale } from "./locale";
import { getSessionUserId } from "./session";

export async function setLocaleAction(locale: string): Promise<void> {
  await persistLocale(locale, {
    getUserId: getSessionUserId,
    setCookie: async (name, value) => {
      (await cookies()).set(name, value, {
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
        sameSite: "lax",
      });
    },
    syncSession: async (locale) => {
      await updateSession({ user: { locale } });
    },
    updateUserLocale: async (userId, dbLocale) => {
      await getDb().user.update({ where: { id: userId }, data: { locale: dbLocale } });
    },
  });
}
