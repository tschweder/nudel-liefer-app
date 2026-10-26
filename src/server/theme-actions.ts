"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { persistTheme } from "./theme";

/**
 * Stores the colour scheme in the cookie the root layout renders (NUD-132). Public on purpose: the
 * toggle also sits on both login screens, where nobody is signed in yet - like `setLocaleAction`, and
 * it only ever touches the caller's own cookie.
 */
export async function setThemeAction(theme: string): Promise<void> {
  await persistTheme(theme, {
    setCookie: async (name, value) => {
      (await cookies()).set(name, value, {
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
        sameSite: "lax",
      });
    },
  });
  revalidatePath("/", "layout");
}
