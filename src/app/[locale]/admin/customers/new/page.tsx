import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import { EmptyState, LoadingSkeleton } from "@/components/shared/states";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { requirePageActor } from "@/server/auth/page-guards";

/** Placeholder so the "New customer" button does not 404. NUD-014 replaces it with the form. */
async function Guarded({ locale }: { locale: string }) {
  await requirePageActor("admin", locale);
  const t = await getTranslations({ locale, namespace: "admin.customers" });
  const tc = await getTranslations({ locale, namespace: "common" });
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl font-semibold" data-testid="section-title">
        {t("new")}
      </h1>
      <EmptyState description={tc("states.comingSoon")}>
        <Link href="/admin/customers" className={buttonVariants({ variant: "outline" })}>
          {t("backToList")}
        </Link>
      </EmptyState>
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
