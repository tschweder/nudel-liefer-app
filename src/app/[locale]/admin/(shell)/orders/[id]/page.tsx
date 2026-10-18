import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import { OrderDetailView } from "@/components/admin/order-detail";
import { LoadingSkeleton } from "@/components/shared/states";
import { orderHistoryQuery } from "@/server/audit-queries";
import { requirePageActor } from "@/server/auth/page-guards";
import { orderDetailQuery } from "@/server/order-queries";
import { getDefaultDeliveryDate } from "@/server/settings";

async function Guarded({ locale, id }: { locale: string; id: string }) {
  await requirePageActor("admin", locale);
  const [order, defaultDate, history] = await Promise.all([
    orderDetailQuery(id),
    getDefaultDeliveryDate(),
    orderHistoryQuery(id),
  ]);
  if (!order) notFound();
  return <OrderDetailView order={order} history={history} defaultDuplicateDate={defaultDate} />;
}

export default async function Page({ params }: PageProps<"/[locale]/admin/orders/[id]">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <Guarded locale={locale} id={id} />
    </Suspense>
  );
}
