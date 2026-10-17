import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import { CustomerForm } from "@/components/admin/customer-form";
import { LoadingSkeleton } from "@/components/shared/states";
import { Link } from "@/i18n/navigation";
import { getMapTileConfig } from "@/lib/map-config";
import { requirePageActor } from "@/server/auth/page-guards";
import { nextCustomerNumberQuery } from "@/server/customer-queries";

async function Guarded({ locale }: { locale: string }) {
  await requirePageActor("admin", locale);
  const t = await getTranslations({ locale, namespace: "admin.customers" });
  const suggestion = await nextCustomerNumberQuery();
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href="/admin/customers"
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          {t("backToList")}
        </Link>
        <h1 className="text-3xl font-semibold" data-testid="section-title">
          {t("new")}
        </h1>
      </div>
      <CustomerForm
        customerId={null}
        tiles={getMapTileConfig()}
        initial={{
          customerNumber: suggestion,
          name: "",
          street: "",
          postalCode: "",
          city: "",
          country: "AT",
          pin: null,
          pinConfirmed: false,
          deliveryHoursInfo: "",
          notes: "",
        }}
      />
    </div>
  );
}

export default async function Page({ params }: PageProps<"/[locale]/admin/customers/new">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <Guarded locale={locale} />
    </Suspense>
  );
}
