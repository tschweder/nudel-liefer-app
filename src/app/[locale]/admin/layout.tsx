import { setRequestLocale } from "next-intl/server";
import { type ReactNode, Suspense } from "react";

import { AdminShell } from "@/components/admin/admin-shell";
import { LoadingSkeleton } from "@/components/shared/states";
import { requirePageActor } from "@/server/auth/page-guards";

async function Gate({ locale, children }: { locale: string; children: ReactNode }) {
  const actor = await requirePageActor("admin", locale);
  return (
    <AdminShell name={actor.name} locale={locale}>
      {children}
    </AdminShell>
  );
}

export default async function AdminLayout({ children, params }: LayoutProps<"/[locale]/admin">) {
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
