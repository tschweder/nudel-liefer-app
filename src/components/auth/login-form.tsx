"use client";

import { useLocale, useTranslations } from "next-intl";
import { useActionState } from "react";

import { LanguageSwitcher } from "@/components/shared/language-switcher";
import { Link } from "@/i18n/navigation";
import { type LoginState } from "@/server/auth/actions";
import { adminLoginAction, driverLoginAction } from "@/server/auth/actions";

const inputClass = "min-h-12 w-full rounded border border-zinc-400 bg-transparent px-3 text-base";

export function LoginForm({
  kind,
  callbackUrl,
}: {
  kind: "admin" | "driver";
  callbackUrl?: string;
}) {
  const t = useTranslations("auth");
  const locale = useLocale();
  const action = kind === "admin" ? adminLoginAction : driverLoginAction;
  const [state, formAction, pending] = useActionState<LoginState, FormData>(action, {
    error: null,
  });
  const ns = kind === "admin" ? "adminLogin" : "driverLogin";

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 p-4">
      {kind === "driver" ? (
        <LanguageSwitcher variant="bar" query={callbackUrl ? { callbackUrl } : undefined} />
      ) : null}
      <h1 className="text-2xl font-semibold" data-testid="login-title">
        {t(`${ns}.title`)}
      </h1>
      <form action={formAction} className="flex flex-col gap-4" data-testid={`${kind}-login-form`}>
        <input type="hidden" name="locale" value={locale} />
        {callbackUrl ? <input type="hidden" name="callbackUrl" value={callbackUrl} /> : null}
        {kind === "admin" ? (
          <>
            <label className="flex flex-col gap-1 text-base">
              {t("adminLogin.email")}
              <input
                className={inputClass}
                name="email"
                type="email"
                autoComplete="username"
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-base">
              {t("adminLogin.password")}
              <input
                className={inputClass}
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </label>
          </>
        ) : (
          <>
            <label className="flex flex-col gap-1 text-base">
              {t("driverLogin.username")}
              <input
                className={inputClass}
                name="username"
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-base">
              {t("driverLogin.pin")}
              <input
                className={`${inputClass} text-center text-2xl tracking-widest`}
                name="pin"
                type="password"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                autoComplete="current-password"
                required
              />
            </label>
          </>
        )}
        {state.error ? (
          <p role="alert" className="text-base text-red-700" data-testid="login-error">
            {t(`errors.${state.error}`)}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          className="min-h-12 rounded bg-zinc-900 px-4 text-base font-semibold text-white disabled:opacity-60"
          data-testid="login-submit"
        >
          {t(`${ns}.submit`)}
        </button>
      </form>
      <Link className="text-base underline" href={kind === "admin" ? "/driver/login" : "/login"}>
        {kind === "admin" ? t("adminLogin.driverLink") : t("driverLogin.adminLink")}
      </Link>
    </main>
  );
}
