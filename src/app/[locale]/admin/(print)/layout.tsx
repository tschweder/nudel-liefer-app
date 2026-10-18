import { setRequestLocale } from "next-intl/server";
import { type ReactNode, Suspense } from "react";

import { LoadingSkeleton } from "@/components/shared/states";
import { requirePageActor } from "@/server/auth/page-guards";

async function Gate({ locale, children }: { locale: string; children: ReactNode }) {
  await requirePageActor("admin", locale);
  return <>{children}</>;
}

/**
 * Admin pages made for paper (NUD-091): the same ADMIN gate as the `(shell)` group but without
 * the sidebar, header and user menu, so nothing but the document is on the page.
 */
export default async function AdminPrintLayout({
  children,
  params,
}: LayoutProps<"/[locale]/admin">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense
      fallback={
        <div className="p-6">
          <LoadingSkeleton />
        </div>
      }
    >
      <Gate locale={locale}>{children}</Gate>
    </Suspense>
  );
}
