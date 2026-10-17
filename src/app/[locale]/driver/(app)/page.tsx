import { setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import { TodayPlaceholder } from "@/components/driver/today-placeholder";
import { LoadingSkeleton } from "@/components/shared/states";
import { requirePageActor } from "@/server/auth/page-guards";

async function Today({ locale }: { locale: string }) {
  const actor = await requirePageActor("driver", locale);
  return <TodayPlaceholder name={actor.name} locale={locale} />;
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
