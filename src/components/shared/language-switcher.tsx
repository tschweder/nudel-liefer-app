"use client";

import { LanguagesIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";

import { usePathname, useRouter } from "@/i18n/navigation";
import { isAppLocale, LOCALE_LABELS } from "@/lib/locale-resolution";
import { LOCALES } from "@/lib/localized-text";
import { cn } from "@/lib/utils";
import { setLocaleAction } from "@/server/locale-actions";

type Variant = "labeled" | "compact" | "icon";

/**
 * Native `<select>` (each language in its own script).
 * `labeled`: visible label (login/start pages). `compact`: label for screen readers only (admin header).
 * `icon`: 48 px icon button that opens the native picker (driver top bar).
 */
export function LanguageSwitcher({ variant = "labeled" }: { variant?: Variant }) {
  const t = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  const select = (
    <select
      className={cn(
        variant === "icon"
          ? "absolute inset-0 size-full cursor-pointer appearance-none opacity-0"
          : "min-h-12 rounded-md border border-input bg-background px-3 text-base",
        variant === "compact" && "min-h-10",
      )}
      value={locale}
      disabled={pending}
      data-testid="language-switcher"
      aria-label={variant === "labeled" ? undefined : t("language")}
      onChange={(event) => {
        const next = event.target.value;
        if (!isAppLocale(next)) return;
        startTransition(async () => {
          await setLocaleAction(next);
          router.replace(pathname, { locale: next });
        });
      }}
    >
      {LOCALES.map((code) => (
        <option key={code} value={code} lang={code}>
          {LOCALE_LABELS[code]}
        </option>
      ))}
    </select>
  );

  if (variant === "icon") {
    return (
      <span className="relative flex size-12 items-center justify-center rounded-md hover:bg-muted focus-within:ring-2 focus-within:ring-ring">
        <LanguagesIcon className="size-6" aria-hidden />
        {select}
      </span>
    );
  }
  return (
    <label className="flex flex-col gap-1 text-base">
      <span className={variant === "compact" ? "sr-only" : undefined}>{t("language")}</span>
      {select}
    </label>
  );
}
