"use client";

import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";

import { usePathname, useRouter } from "@/i18n/navigation";
import { isAppLocale, LOCALE_LABELS } from "@/lib/locale-resolution";
import { LOCALES } from "@/lib/localized-text";
import { setLocaleAction } from "@/server/locale-actions";

export function LanguageSwitcher() {
  const t = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  return (
    <label className="flex flex-col gap-1 text-base">
      <span>{t("language")}</span>
      <select
        className="min-h-12 rounded border border-zinc-400 bg-transparent px-3 text-base"
        value={locale}
        disabled={pending}
        data-testid="language-switcher"
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
    </label>
  );
}
