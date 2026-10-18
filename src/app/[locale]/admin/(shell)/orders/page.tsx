import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import { OrderFilters } from "@/components/admin/order-filters";
import { OrderTotals } from "@/components/admin/order-totals";
import { OrdersTable } from "@/components/admin/orders-table";
import { LoadingSkeleton } from "@/components/shared/states";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { requirePageActor } from "@/server/auth/page-guards";
import { orderOverviewQuery } from "@/server/order-queries";
import { OVERVIEW_LIMIT } from "@/server/orders";

/** Order overview (NUD-032): filters (default = next delivery date), totals per date, rows. */
async function Guarded({
  locale,
  searchParams,
}: {
  locale: string;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePageActor("admin", locale);
  const t = await getTranslations({ locale, namespace: "admin.orders" });
  const overview = await orderOverviewQuery(await searchParams);
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
      <OrderFilters filters={overview.filters} customers={overview.customers} />
      <OrderTotals totals={overview.totals} />
      {overview.truncated ? (
        <p className="text-sm text-destructive" role="status" data-testid="orders-truncated">
          {t("truncated", { count: OVERVIEW_LIMIT })}
        </p>
      ) : null}
      <OrdersTable orders={overview.rows} />
    </div>
  );
}

export default async function Page({ params, searchParams }: PageProps<"/[locale]/admin/orders">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <Guarded locale={locale} searchParams={searchParams} />
    </Suspense>
  );
}
