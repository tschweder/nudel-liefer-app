"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";

import type { AppRole } from "@/lib/access";
import { postLoginPath } from "@/lib/access";
import { isAppLocale, LOCALE_COOKIE } from "@/lib/locale-resolution";
import { dbLocaleToTag } from "@/lib/localized-text";

import { getDb } from "../db";
import { auth, signIn, signOut } from "./auth";
import type { LoginKind } from "./authenticate";
import { type LoginError, parseSignInResult } from "./sign-in-result";

export type LoginState = { error: LoginError | null };

async function login(kind: LoginKind, formData: FormData): Promise<LoginState> {
  const idField = kind === "admin" ? "email" : "username";
  const secretField = kind === "admin" ? "password" : "pin";
  const identifier = String(formData.get(idField) ?? "");
  const secret = String(formData.get(secretField) ?? "");
  const callbackUrl = formData.get("callbackUrl");

  let error: LoginError | null;
  try {
    const url = await signIn(kind, {
      [idField]: identifier,
      [secretField]: secret,
      redirect: false,
    });
    error = parseSignInResult(url).error;
  } catch (e) {
    if (!(e instanceof AuthError)) throw e;
    error = parseSignInResult(`/?error=${e.type}&code=${"code" in e ? String(e.code) : ""}`).error;
  }
  if (error) return { error };

  // Signed in: apply the user's own locale (not the one of the page the form was on).
  const user = await getDb().user.findFirst({
    where:
      kind === "admin"
        ? { role: "ADMIN", email: { equals: identifier.trim(), mode: "insensitive" } }
        : { role: "DRIVER", username: { equals: identifier.trim(), mode: "insensitive" } },
  });
  if (!user) return { error: "generic" };
  const locale = dbLocaleToTag(user.locale);
  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  redirect(
    postLoginPath({
      role: user.role,
      locale,
      callbackUrl: typeof callbackUrl === "string" ? callbackUrl : null,
    }),
  );
}

export async function adminLoginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  return login("admin", formData);
}

export async function driverLoginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  return login("driver", formData);
}

export async function logoutAction(formData: FormData): Promise<void> {
  const session = await auth();
  const role: AppRole | undefined = session?.user?.role;
  const posted = formData.get("locale");
  const locale = isAppLocale(posted) ? posted : "de";
  await signOut({ redirect: false });
  redirect(`/${locale}${role === "DRIVER" ? "/driver/login" : "/login"}`);
}
