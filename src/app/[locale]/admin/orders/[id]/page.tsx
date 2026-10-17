import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import { OrderDetailView } from "@/components/admin/order-detail";
import { LoadingSkeleton } from "@/components/shared/states";
import { requirePageActor } from "@/server/auth/page-guards";
import { orderDetailQuery } from "@/server/order-queries";

async function Guarded({ locale, id }: { locale: string; id: string }) {
  await requirePageActor("admin", locale);
  const order = await orderDetailQuery(id);
  if (!order) notFound();
  return <OrderDetailView order={order} />;
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
