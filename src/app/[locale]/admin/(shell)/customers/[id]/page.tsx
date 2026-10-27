import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import { CustomerDetailView } from "@/components/admin/customer-detail";
import { LoadingSkeleton } from "@/components/shared/states";
import { getMapTileConfig } from "@/lib/map-config";
import { requirePageActor } from "@/server/auth/page-guards";
import {
  customerKeyHistoryQuery,
  customerPhotosQuery,
  getCustomerQuery,
  noteTranslationsQuery,
  parkingSpotsQuery,
  upcomingOrdersQuery,
} from "@/server/customer-queries";

const toSlot = ({
  id,
  url,
  width,
  height,
  createdAt,
  uploadedBy,
}: {
  id: string;
  url: string;
  width: number;
  height: number;
  createdAt: Date;
  uploadedBy: { name: string; role: "ADMIN" | "DRIVER" };
}) => ({
  id,
  url,
  width,
  height,
  createdAt: createdAt.toISOString(),
  // Only drivers are named: the office knows its own uploads (NUD-083 "updated by driver X").
  driverName: uploadedBy.role === "DRIVER" ? uploadedBy.name : null,
});

async function Guarded({ locale, id }: { locale: string; id: string }) {
  await requirePageActor("admin", locale);
  const customer = await getCustomerQuery(id);
  if (!customer) notFound();
  const [orders, photos, noteTranslations, parkingSpots, keyHistory] = await Promise.all([
    upcomingOrdersQuery(id),
    customerPhotosQuery(id),
    noteTranslationsQuery(id),
    parkingSpotsQuery(id),
    customerKeyHistoryQuery(id),
  ]);
  return (
    <CustomerDetailView
      customer={customer}
      orders={orders}
      noteTranslations={noteTranslations}
      parkingSpots={parkingSpots}
      keyHistory={keyHistory}
      tiles={getMapTileConfig()}
      photos={{
        STORE: photos.STORE && toSlot(photos.STORE),
        PARKING: photos.PARKING && toSlot(photos.PARKING),
      }}
    />
  );
}

export default async function Page({ params }: PageProps<"/[locale]/admin/customers/[id]">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <Guarded locale={locale} id={id} />
    </Suspense>
  );
}
