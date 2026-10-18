import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import { TourDateField } from "@/components/admin/tour-date-field";
import { TourPlanner } from "@/components/admin/tour-planner";
import { LoadingSkeleton } from "@/components/shared/states";
import { getMapTileConfig } from "@/lib/map-config";
import { requirePageActor } from "@/server/auth/page-guards";
import { getLivePollIntervalMs } from "@/server/tour-progress";
import { tourPlanQuery } from "@/server/tour-queries";

/** Tour planning (NUD-042): `/admin/tours?date=YYYY-MM-DD` (default = next delivery date). */
async function Guarded({
  locale,
  searchParams,
}: {
  locale: string;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePageActor("admin", locale);
  const t = await getTranslations({ locale, namespace: "admin.tours" });
  const { date } = await searchParams;
  const plan = await tourPlanQuery(Array.isArray(date) ? date[0] : date);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold" data-testid="section-title">
            {t("title")}
          </h1>
          <p className="max-w-2xl text-base text-muted-foreground">{t("description")}</p>
        </div>
        <TourDateField value={plan.date} />
      </div>
      <TourPlanner
        plan={plan}
        tiles={getMapTileConfig()}
        pollIntervalMs={getLivePollIntervalMs()}
      />
    </div>
  );
}

export default async function Page({ searchParams, params }: PageProps<"/[locale]/admin/tours">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <Guarded locale={locale} searchParams={searchParams} />
    </Suspense>
  );
}
