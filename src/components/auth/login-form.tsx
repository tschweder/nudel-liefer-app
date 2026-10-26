"use client";

import { EyeIcon, EyeOffIcon, KeyRoundIcon, LogInIcon, UserIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { FormEvent, ReactNode } from "react";
import { useActionState, useState, useTransition } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PinInput } from "@/components/ui/pin-input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { isAppLocale, LOCALE_LABELS } from "@/lib/locale-resolution";
import { LOCALES } from "@/lib/localized-text";
import { cn } from "@/lib/utils";
import { adminLoginAction, driverLoginAction,type LoginState } from "@/server/auth/actions";
import { setLocaleAction } from "@/server/locale-actions";

/** Codes for the six-digit PIN; also drives the client-side pre-check (F1). */
const PIN_PATTERN = /^\d{6}$/;

/** Short pill labels (own script, not translated) for the driver login language picker. */
const LANGUAGE_SHORT_LABELS: Record<string, string> = {
  de: "DE",
  "zh-Hans": "简体",
  "zh-Hant-HK": "繁體(港)",
  "zh-Hant-TW": "繁體(台)",
};

/**
 * Inline brand mark (re-design.md §7.5/§8.9): wordmark "Nudel Liefer" plus a terracotta dot, pure
 * CSS — no image file, no external font. The dot flips to the foreground colour on the terracotta
 * office panel where a terracotta dot would disappear.
 */
function BrandMark({ onPrimary = false, className }: { onPrimary?: boolean; className?: string }) {
  return (
    <p
      className={cn(
        "flex items-center gap-2 text-lg font-semibold tracking-tight",
        onPrimary ? "text-primary-foreground" : "text-foreground",
        className,
      )}
    >
      <span>Nudel Liefer</span>
      <span
        aria-hidden
        className={cn("size-2.5 rounded-full", onPrimary ? "bg-primary-foreground" : "bg-primary")}
      />
    </p>
  );
}

/**
 * Language picker (re-design.md §7.5): a row of four pills. The `select` next to it is the element
 * the e2e specs drive (`selectOption`, exact option texts); it is transparent and
 * `pointer-events-none`, so real users always use the pills — the picker itself stays fully
 * functional without JavaScript-injected test ids.
 */
function LanguagePills({ callbackUrl }: { callbackUrl?: string }) {
  const t = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  const changeLocale = (next: string) => {
    if (!isAppLocale(next) || next === locale) return;
    startTransition(async () => {
      await setLocaleAction(next);
      router.replace(callbackUrl ? { pathname, query: { callbackUrl } } : pathname, { locale: next });
    });
  };

  return (
    // NOT `language-picker`: that id belongs to the full-screen first-start picker
    // (`DriverLanguagePicker`), and two elements with the same test id make the picker unreachable for
    // `getByTestId` (Playwright strict mode) — a regression the redesign introduced.
    <div className="relative" data-testid="login-language-picker">
      <SegmentedControl
        value={locale}
        onValueChange={changeLocale}
        size="lg"
        ariaLabel={t("language")}
        className={cn(
          // Driver touch targets: the kit's `lg` track is 48 px with 44 px pills; a 52 px track and
          // 48 px pills (`self-stretch` from the kit plus an explicit min-height). `px-1.5` keeps
          // the "(港)/(台)" CJK labels whole.
          "h-13 [&>button]:min-h-12 [&>button]:px-1.5",
          pending && "opacity-70",
        )}
        options={LOCALES.map((code) => ({
          value: code,
          label: LANGUAGE_SHORT_LABELS[code] ?? LOCALE_LABELS[code],
          testId: `pick-${code}`,
        }))}
      />
      <select
        data-testid="language-switcher"
        aria-label={t("language")}
        tabIndex={-1}
        value={locale}
        onChange={(event) => changeLocale(event.target.value)}
        className="pointer-events-none absolute inset-0 z-10 h-full w-full opacity-0"
      >
        {LOCALES.map((code) => (
          <option key={code} value={code} lang={code}>
            {LOCALE_LABELS[code]}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Driver login (re-design.md §7.5, fixes QA finding F1).
 *
 * `noValidate` plus client-side pre-checks replace the English browser validation bubble: a PIN that
 * is not six digits never reaches the server action, the error is a localized German string under
 * the field and inside an `aria-live="polite"` region. The server action still runs for everything
 * else and its error codes keep rendering under `data-testid="login-error"`.
 */
function DriverLoginForm({ callbackUrl }: { callbackUrl?: string }) {
  const t = useTranslations("auth");
  const locale = useLocale();
  const [pin, setPin] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ username?: string; pin?: string }>({});
  const [state, formAction, pending] = useActionState<LoginState, FormData>(driverLoginAction, {
    error: null,
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    // Validate the *submitted* values (not component state): Playwright's `fill()` writes the DOM
    // value directly and the e2e specs log in that way. Preventing the default here also cancels
    // React's form action (react-dom skips the action when `defaultPrevented` is set), so an
    // invalid PIN never leaves the browser.
    const data = new FormData(event.currentTarget);
    const next: typeof fieldErrors = {};
    if (!String(data.get("username") ?? "").trim()) next.username = t("errors.usernameRequired");
    if (!PIN_PATTERN.test(String(data.get("pin") ?? ""))) next.pin = t("errors.pinLength");
    setFieldErrors(next);
    if (next.username || next.pin) event.preventDefault();
  };

  // The server's `invalid` code is the "wrong credentials" case: name the actual reason under the
  // field, while the spec-required banner keeps the generic `auth.errors.invalid` sentence.
  const pinError = fieldErrors.pin ?? (state.error === "invalid" ? t("errors.credentials") : undefined);

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 p-6">
      <BrandMark />
      <h1 id="driver-login-title" className="text-2xl font-semibold" data-testid="login-title">
        {t("driverLogin.title")}
      </h1>

      <LanguagePills callbackUrl={callbackUrl} />

      <form
        action={formAction}
        noValidate
        onSubmit={handleSubmit}
        aria-labelledby="driver-login-title"
        className="flex flex-col gap-4"
        data-testid="driver-login-form"
      >
        <input type="hidden" name="locale" value={locale} />
        {callbackUrl ? <input type="hidden" name="callbackUrl" value={callbackUrl} /> : null}

        <div aria-live="polite">
          <FormField
            id="driver-username"
            error={fieldErrors.username}
            label={
              <>
                <UserIcon className="size-5 shrink-0" aria-hidden />
                <span>{t("driverLogin.username")}</span>
              </>
            }
          >
            <Input
              id="driver-username"
              name="username"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              className="h-12"
            />
          </FormField>
        </div>

        <div aria-live="polite">
          <FormField
            id="driver-pin"
            error={pinError}
            label={
              <>
                <KeyRoundIcon className="size-5 shrink-0" aria-hidden />
                <span>{t("driverLogin.pin")}</span>
              </>
            }
          >
            <PinInput id="driver-pin" name="pin" value={pin} onChange={setPin} />
          </FormField>
        </div>

        {state.error ? (
          <p role="alert" className="text-base font-medium text-destructive" data-testid="login-error">
            {t(`errors.${state.error}`)}
          </p>
        ) : null}

        <Button
          type="submit"
          size="xl"
          loading={pending}
          className="w-full"
          data-testid="login-submit"
        >
          {pending ? null : <LogInIcon aria-hidden />}
          {t("driverLogin.submit")}
        </Button>
      </form>

      <Link
        href="/login"
        className={cn(buttonVariants({ variant: "ghost", size: "lg" }), "w-full")}
      >
        {t("driverLogin.adminLink")}
      </Link>
    </main>
  );
}

/**
 * Office login (re-design.md §8.9). Split layout from 1024 px (45 % brand panel, form card),
 * single centred column below. `noValidate` and the same inline-error treatment as the driver login;
 * the server's `auth.errors.<code>` still renders under `data-testid="login-error"`.
 */
function AdminLoginForm({ callbackUrl }: { callbackUrl?: string }) {
  const t = useTranslations("auth");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [state, formAction, pending] = useActionState<LoginState, FormData>(adminLoginAction, {
    error: null,
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    // See the driver form: prevent the default (which also cancels React's form action) instead of
    // submitting an empty office login to the server.
    const data = new FormData(event.currentTarget);
    const next: typeof fieldErrors = {};
    if (!String(data.get("email") ?? "").trim()) next.email = t("errors.emailRequired");
    if (!String(data.get("password") ?? "")) next.password = t("errors.passwordRequired");
    setFieldErrors(next);
    if (next.email || next.password) event.preventDefault();
  };

  const passwordToggle: ReactNode = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={showPassword ? t("adminLogin.hidePassword") : t("adminLogin.showPassword")}
      aria-pressed={showPassword}
      onClick={() => setShowPassword((value) => !value)}
      className="absolute top-1/2 right-0.5 size-11 -translate-y-1/2 text-muted-foreground"
    >
      {showPassword ? <EyeOffIcon aria-hidden /> : <EyeIcon aria-hidden />}
    </Button>
  );

  return (
    <main className="flex min-h-dvh w-full flex-1 flex-col lg:flex-row">
      <aside className="hidden flex-col justify-between gap-8 bg-gradient-to-br from-primary to-primary-hover p-12 text-primary-foreground lg:flex lg:w-[45%]">
        <BrandMark onPrimary />
        <p className="max-w-md text-2xl leading-snug font-medium">{t("adminLogin.brandSentence")}</p>
        <p className="text-sm text-primary-foreground/80">{tCommon("appName")}</p>
      </aside>

      <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
        <BrandMark className="lg:hidden" />

        <Card className="w-full max-w-md p-6">
          <h1 className="text-2xl font-semibold" data-testid="login-title">
            {t("adminLogin.title")}
          </h1>

          <form
            action={formAction}
            noValidate
            onSubmit={handleSubmit}
            className="mt-5 flex flex-col gap-4"
            data-testid="admin-login-form"
          >
            <input type="hidden" name="locale" value={locale} />
            {callbackUrl ? <input type="hidden" name="callbackUrl" value={callbackUrl} /> : null}

            <div aria-live="polite">
              <FormField id="admin-email" error={fieldErrors.email} label={t("adminLogin.email")}>
                <Input
                  id="admin-email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  className="h-11"
                />
              </FormField>
            </div>

            <div aria-live="polite">
              {/* Hand-wired (not `FormField`): the show/hide toggle must sit inside the field box. */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="admin-password">{t("adminLogin.password")}</Label>
                <div className="relative">
                  <Input
                    id="admin-password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    className="h-11 pr-12"
                    aria-invalid={fieldErrors.password ? true : undefined}
                    aria-describedby={fieldErrors.password ? "admin-password-error" : undefined}
                  />
                  {passwordToggle}
                </div>
                {fieldErrors.password ? (
                  <p id="admin-password-error" className="text-sm font-medium text-destructive">
                    {fieldErrors.password}
                  </p>
                ) : null}
              </div>
            </div>

            {state.error ? (
              <p
                role="alert"
                className="text-base font-medium text-destructive"
                data-testid="login-error"
              >
                {t(`errors.${state.error}`)}
              </p>
            ) : null}

            <Button
              type="submit"
              loading={pending}
              className="h-11 w-full"
              data-testid="login-submit"
            >
              {pending ? null : <LogInIcon aria-hidden />}
              {t("adminLogin.submit")}
            </Button>
          </form>
        </Card>

        <Link
          href="/driver/login"
          className={buttonVariants({ variant: "ghost", size: "lg" })}
        >
          {t("adminLogin.driverLink")}
        </Link>
      </div>
    </main>
  );
}

export function LoginForm({
  kind,
  callbackUrl,
}: {
  kind: "admin" | "driver";
  callbackUrl?: string;
}) {
  return kind === "admin" ? (
    <AdminLoginForm callbackUrl={callbackUrl} />
  ) : (
    <DriverLoginForm callbackUrl={callbackUrl} />
  );
}
