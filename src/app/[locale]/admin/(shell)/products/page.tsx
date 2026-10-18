import { PlusIcon } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import { ProductsTable } from "@/components/admin/products-table";
import { LoadingSkeleton } from "@/components/shared/states";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { requirePageActor } from "@/server/auth/page-guards";
import { listProductsQuery } from "@/server/product-queries";

async function Guarded({ locale }: { locale: string }) {
  // Defence in depth behind the proxy and the admin layout; the query re-checks the role too.
  await requirePageActor("admin", locale);
  const t = await getTranslations({ locale, namespace: "admin.products" });
  const rows = await listProductsQuery();
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-semibold" data-testid="section-title">
            {t("title")}
          </h1>
          <p className="max-w-prose text-muted-foreground">{t("description")}</p>
        </div>
        <Link href="/admin/products/new" className={buttonVariants()} data-testid="new-product">
          <PlusIcon aria-hidden />
          {t("new")}
        </Link>
      </div>
      <ProductsTable rows={rows} />
    </div>
  );
}

export default async function Page({ params }: PageProps<"/[locale]/admin/products">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <Guarded locale={locale} />
    </Suspense>
  );
}
