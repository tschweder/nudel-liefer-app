import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import { LogoutButton } from "@/components/auth/logout-button";
import { TodayTour } from "@/components/driver/today-tour";
import { EmptyState, LoadingSkeleton } from "@/components/shared/states";
import type { AppLocale } from "@/lib/localized-text";
import { getMapTileConfig } from "@/lib/map-config";
import { requirePageActor } from "@/server/auth/page-guards";
import { driverTodayQuery } from "@/server/driver-today";

async function Today({ locale }: { locale: string }) {
  const actor = await requirePageActor("driver", locale);
  const t = await getTranslations({ locale, namespace: "driver" });
  const today = await driverTodayQuery(locale as AppLocale);
  return (
    <>
      <h1 className="sr-only" data-testid="driver-title">
        {t("home.title")}
      </h1>
      {today && today.stops.length > 0 ? (
        <TodayTour today={today} tiles={getMapTileConfig()} />
      ) : (
        <EmptyState title={t("today.emptyTitle")} description={t("today.emptyDescription")} />
      )}
      <footer className="mt-4 flex flex-col items-start gap-2">
        <p className="text-base" data-testid="signed-in-as">
          {t("home.welcome", { name: actor.name })}
        </p>
        <LogoutButton locale={locale} />
      </footer>
    </>
  );
}

export default async function DriverTodayPage({ params }: PageProps<"/[locale]/driver">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <Today locale={locale} />
    </Suspense>
  );
}
