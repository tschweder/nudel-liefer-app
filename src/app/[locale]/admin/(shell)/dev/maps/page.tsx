import { setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import { MapsDemo } from "@/components/maps/maps-demo";
import { LoadingSkeleton } from "@/components/shared/states";
import { getMapTileConfig } from "@/lib/map-config";
import { requirePageActor } from "@/server/auth/page-guards";

async function Guarded({ locale }: { locale: string }) {
  // Defence in depth behind the proxy and the admin layout. Hidden dev page: not in the nav.
  await requirePageActor("admin", locale);
  return <MapsDemo tiles={getMapTileConfig()} />;
}

export default async function Page({ params }: PageProps<"/[locale]/admin/dev/maps">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <Guarded locale={locale} />
    </Suspense>
  );
}
