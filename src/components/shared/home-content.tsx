import { useTranslations } from "next-intl";

import { LanguageSwitcher } from "./language-switcher";

export function HomeContent() {
  const t = useTranslations("home");
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-4">
      <h1 className="text-3xl font-semibold" data-testid="title">
        {t("title")}
      </h1>
      <p className="text-base text-zinc-600">{t("placeholder")}</p>
      <LanguageSwitcher />
    </main>
  );
}
