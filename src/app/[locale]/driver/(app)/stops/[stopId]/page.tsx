import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import { StopDetail } from "@/components/driver/stop-detail";
import { LoadingSkeleton } from "@/components/shared/states";
import type { AppLocale } from "@/lib/localized-text";
import { getMapTileConfig } from "@/lib/map-config";
import { requirePageActor } from "@/server/auth/page-guards";
import { driverStopQuery } from "@/server/driver-stop";

// 404 unless the stop belongs to the driver's own released tour of today (checked in the query).
async function StopContent({ locale, stopId }: { locale: string; stopId: string }) {
  await requirePageActor("driver", locale);
  const detail = await driverStopQuery(locale as AppLocale, stopId);
  if (!detail) notFound();
  return <StopDetail detail={detail} tiles={getMapTileConfig()} />;
}

export default async function DriverStopPage({
  params,
}: PageProps<"/[locale]/driver/stops/[stopId]">) {
  const { locale, stopId } = await params;
  setRequestLocale(locale);
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <StopContent locale={locale} stopId={stopId} />
    </Suspense>
  );
}
