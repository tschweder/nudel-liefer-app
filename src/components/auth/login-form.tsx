"use client";

import { KeyRoundIcon, LogInIcon, UserIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useActionState } from "react";

import { LanguageSwitcher } from "@/components/shared/language-switcher";
import { Link } from "@/i18n/navigation";
import { type LoginState } from "@/server/auth/actions";
import { adminLoginAction, driverLoginAction } from "@/server/auth/actions";

const inputClass =
  "min-h-12 w-full rounded border border-input bg-transparent px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring";

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
              <span className="flex items-center gap-2">
                <UserIcon className="size-5 shrink-0" aria-hidden />
                {t("driverLogin.username")}
              </span>
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
              <span className="flex items-center gap-2">
                <KeyRoundIcon className="size-5 shrink-0" aria-hidden />
                {t("driverLogin.pin")}
              </span>
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
          <p
            role="alert"
            className="text-base font-medium text-destructive"
            data-testid="login-error"
          >
            {t(`errors.${state.error}`)}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          className="flex min-h-12 items-center justify-center gap-2 rounded bg-primary px-4 text-base font-semibold text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-60"
          data-testid="login-submit"
        >
          <LogInIcon className="size-5 shrink-0" aria-hidden />
          {t(`${ns}.submit`)}
        </button>
      </form>
      <Link
        className="flex min-h-12 items-center text-base underline outline-none focus-visible:ring-2 focus-visible:ring-ring"
        href={kind === "admin" ? "/driver/login" : "/login"}
      >
        {kind === "admin" ? t("adminLogin.driverLink") : t("driverLogin.adminLink")}
      </Link>
    </main>
  );
}
