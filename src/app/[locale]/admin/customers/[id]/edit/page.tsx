import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import { CustomerForm } from "@/components/admin/customer-form";
import { LoadingSkeleton } from "@/components/shared/states";
import { Link } from "@/i18n/navigation";
import { getMapTileConfig } from "@/lib/map-config";
import { requirePageActor } from "@/server/auth/page-guards";
import { getCustomerQuery } from "@/server/customer-queries";

async function Guarded({ locale, id }: { locale: string; id: string }) {
  await requirePageActor("admin", locale);
  const customer = await getCustomerQuery(id);
  if (!customer) notFound();
  const t = await getTranslations({ locale, namespace: "admin.customers" });
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href={`/admin/customers/${customer.id}`}
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          {t("form.backToDetail")}
        </Link>
        <h1 className="text-3xl font-semibold" data-testid="section-title">
          {t("form.editTitle")}
        </h1>
      </div>
      <CustomerForm
        customerId={customer.id}
        tiles={getMapTileConfig()}
        initial={{
          customerNumber: customer.customerNumber,
          name: customer.name,
          street: customer.street,
          postalCode: customer.postalCode,
          city: customer.city,
          country: customer.country,
          pin:
            customer.lat !== null && customer.lng !== null
              ? { lat: customer.lat, lng: customer.lng }
              : null,
          pinConfirmed: customer.pinConfirmed,
          deliveryHoursInfo: customer.deliveryHoursInfo ?? "",
          notes: customer.notes,
        }}
      />
    </div>
  );
}

export default async function Page({ params }: PageProps<"/[locale]/admin/customers/[id]/edit">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <Guarded locale={locale} id={id} />
    </Suspense>
  );
}
