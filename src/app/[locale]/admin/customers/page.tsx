import { PlusIcon } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import { CustomerFilters } from "@/components/admin/customer-filters";
import { CustomersTable } from "@/components/admin/customers-table";
import { LoadingSkeleton } from "@/components/shared/states";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { parseCustomerListParams } from "@/lib/customer-list-params";
import { requirePageActor } from "@/server/auth/page-guards";
import { listCustomersQuery } from "@/server/customer-queries";

async function Guarded({
  locale,
  searchParams,
}: {
  locale: string;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Defence in depth behind the proxy and the admin layout; the query re-checks the role too.
  await requirePageActor("admin", locale);
  const t = await getTranslations({ locale, namespace: "admin.customers" });
  const input = parseCustomerListParams(await searchParams);
  const result = await listCustomersQuery(input);
  const filters = {
    q: input.q,
    status: input.status,
    photosMissing: input.photosMissing,
    pinUnconfirmed: input.pinUnconfirmed,
  };
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-semibold" data-testid="section-title">
            {t("title")}
          </h1>
          <p className="max-w-prose text-muted-foreground">{t("description")}</p>
        </div>
        <Link href="/admin/customers/new" className={buttonVariants()} data-testid="new-customer">
          <PlusIcon aria-hidden />
          {t("new")}
        </Link>
      </div>
      <CustomerFilters values={filters} />
      <CustomersTable result={result} filters={filters} />
    </div>
  );
}

export default async function Page({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/customers">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <Guarded locale={locale} searchParams={searchParams} />
    </Suspense>
  );
}
