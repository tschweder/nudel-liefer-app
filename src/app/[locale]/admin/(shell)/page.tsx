import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import { TodayCard } from "@/components/admin/today-card";
import { LoadingSkeleton } from "@/components/shared/states";
import { requirePageActor } from "@/server/auth/page-guards";
import { getLivePollIntervalMs, todayProgressQuery } from "@/server/tour-progress";

async function Dashboard({ locale }: { locale: string }) {
  const actor = await requirePageActor("admin", locale);
  const t = await getTranslations({ locale });
  const today = await todayProgressQuery();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl font-semibold" data-testid="admin-title">
        {t("admin.dashboard.title")}
      </h1>
      <p className="text-base">{t("admin.dashboard.welcome")}</p>
      <p className="text-base text-muted-foreground" data-testid="signed-in-as-page">
        {t("auth.signedInAs", { name: actor.name })}
      </p>
      <TodayCard today={today} pollIntervalMs={getLivePollIntervalMs()} />
    </div>
  );
}

export default async function AdminDashboardPage({ params }: PageProps<"/[locale]/admin">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <Dashboard locale={locale} />
    </Suspense>
  );
}
