import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import { CustomerDetailView } from "@/components/admin/customer-detail";
import { LoadingSkeleton } from "@/components/shared/states";
import { requirePageActor } from "@/server/auth/page-guards";
import {
  customerPhotosQuery,
  getCustomerQuery,
  noteTranslationsQuery,
  upcomingOrdersQuery,
} from "@/server/customer-queries";

const toSlot = ({
  id,
  url,
  width,
  height,
}: {
  id: string;
  url: string;
  width: number;
  height: number;
}) => ({
  id,
  url,
  width,
  height,
});

async function Guarded({ locale, id }: { locale: string; id: string }) {
  await requirePageActor("admin", locale);
  const customer = await getCustomerQuery(id);
  if (!customer) notFound();
  const [orders, photos, noteTranslations] = await Promise.all([
    upcomingOrdersQuery(id),
    customerPhotosQuery(id),
    noteTranslationsQuery(id),
  ]);
  return (
    <CustomerDetailView
      customer={customer}
      orders={orders}
      noteTranslations={noteTranslations}
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
