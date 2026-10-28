import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import { CustomerDetailView } from "@/components/admin/customer-detail";
import { LoadingSkeleton } from "@/components/shared/states";
import { formatCalendarDate } from "@/domain/order";
import { type AppLocale, pick } from "@/lib/localized-text";
import { getMapTileConfig } from "@/lib/map-config";
import { requirePageActor } from "@/server/auth/page-guards";
import {
  customerAbbreviationHistoryQuery,
  customerKeyHistoryQuery,
  customerPhotosQuery,
  getCustomerQuery,
  noteTranslationsQuery,
  parkingSpotsQuery,
  recurringOrdersQuery,
  upcomingOrdersQuery,
} from "@/server/customer-queries";
import { todayIn } from "@/server/orders";
import { activeProductsQuery } from "@/server/product-queries";
import { getFactoryTimezone } from "@/server/settings";

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
  const [
    orders,
    photos,
    noteTranslations,
    parkingSpots,
    keyHistory,
    abbreviationHistory,
    rules,
    products,
    timezone,
  ] = await Promise.all([
    upcomingOrdersQuery(id),
    customerPhotosQuery(id),
    noteTranslationsQuery(id),
    parkingSpotsQuery(id),
    customerKeyHistoryQuery(id),
    customerAbbreviationHistoryQuery(id),
    recurringOrdersQuery(id),
    activeProductsQuery(),
    getFactoryTimezone(),
  ]);
  return (
    <CustomerDetailView
      customer={customer}
      orders={orders}
      noteTranslations={noteTranslations}
      parkingSpots={parkingSpots}
      keyHistory={keyHistory}
      abbreviationHistory={abbreviationHistory}
      tiles={getMapTileConfig()}
      recurringRules={rules}
      recurringProducts={products.map((p) => ({
        id: p.id,
        label: `${pick(p.name, locale as AppLocale)} (${p.sku})`,
        unit: p.unit,
      }))}
      today={formatCalendarDate(todayIn(timezone))}
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
