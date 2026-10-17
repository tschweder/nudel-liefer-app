import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import { LogoutButton } from "@/components/auth/logout-button";
import { LanguageSwitcher } from "@/components/shared/language-switcher";
import { requirePageActor } from "@/server/auth/page-guards";

async function Dashboard({ locale }: { locale: string }) {
  const actor = await requirePageActor("admin", locale);
  const t = await getTranslations({ locale });
  return (
    <main className="flex flex-1 flex-col gap-4 p-4">
      <h1 className="text-3xl font-semibold" data-testid="admin-title">
        {t("admin.dashboard.title")}
      </h1>
      <p className="text-base">{t("admin.dashboard.welcome")}</p>
      <p className="text-base" data-testid="signed-in-as">
        {t("auth.signedInAs", { name: actor.name })}
      </p>
      <LanguageSwitcher />
      <LogoutButton locale={locale} />
    </main>
  );
}

export default async function AdminDashboardPage({ params }: PageProps<"/[locale]/admin">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense>
      <Dashboard locale={locale} />
    </Suspense>
  );
}
