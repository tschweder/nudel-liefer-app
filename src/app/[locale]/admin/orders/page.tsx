import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import { OrdersTable } from "@/components/admin/orders-table";
import { LoadingSkeleton } from "@/components/shared/states";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { requirePageActor } from "@/server/auth/page-guards";
import { orderOverviewQuery } from "@/server/order-queries";

/** Minimal order list (NUD-030). NUD-032 replaces it with the full overview. */
async function Guarded({ locale }: { locale: string }) {
  await requirePageActor("admin", locale);
  const t = await getTranslations({ locale, namespace: "admin.orders" });
  const orders = await orderOverviewQuery();
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold" data-testid="section-title">
            {t("title")}
          </h1>
          <p className="max-w-2xl text-base text-muted-foreground">{t("description")}</p>
        </div>
        <Link href="/admin/orders/new" className={buttonVariants()} data-testid="new-order">
          {t("new")}
        </Link>
      </div>
      <OrdersTable orders={orders} />
    </div>
  );
}

export default async function Page({ params }: PageProps<"/[locale]/admin/orders">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <Guarded locale={locale} />
    </Suspense>
  );
}
