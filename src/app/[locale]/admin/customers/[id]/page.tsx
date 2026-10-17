import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import { CustomerDetailView } from "@/components/admin/customer-detail";
import { LoadingSkeleton } from "@/components/shared/states";
import { requirePageActor } from "@/server/auth/page-guards";
import { getCustomerQuery, upcomingOrdersQuery } from "@/server/customer-queries";

async function Guarded({ locale, id }: { locale: string; id: string }) {
  await requirePageActor("admin", locale);
  const customer = await getCustomerQuery(id);
  if (!customer) notFound();
  const orders = await upcomingOrdersQuery(id);
  return <CustomerDetailView customer={customer} orders={orders} />;
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
