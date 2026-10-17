import { ArrowLeftIcon } from "lucide-react";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import { LoadingSkeleton } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/lib/localized-text";
import { requirePageActor } from "@/server/auth/page-guards";
import { driverTodayQuery } from "@/server/driver-today";

// Placeholder until the real stop detail screen (NUD-052): it only checks that the stop belongs to
// the driver's own tour of today and names it.
async function StopPlaceholder({ locale, stopId }: { locale: string; stopId: string }) {
  await requirePageActor("driver", locale);
  const t = await getTranslations({ locale, namespace: "driver" });
  const today = await driverTodayQuery(locale as AppLocale);
  const stop = today?.stops.find((s) => s.id === stopId);
  if (!stop) notFound();
  return (
    <div className="space-y-4" data-testid="stop-detail">
      <Button asChild variant="outline" size="lg">
        <Link href="/driver">
          <ArrowLeftIcon className="size-5" aria-hidden />
          {t("stop.back")}
        </Link>
      </Button>
      <h1 className="text-2xl font-bold">
        {stop.sequence}. {stop.customerName}
      </h1>
      <p className="text-base text-muted-foreground">{t("stop.comingSoon")}</p>
    </div>
  );
}

export default async function DriverStopPage({
  params,
}: PageProps<"/[locale]/driver/stops/[stopId]">) {
  const { locale, stopId } = await params;
  setRequestLocale(locale);
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <StopPlaceholder locale={locale} stopId={stopId} />
    </Suspense>
  );
}
