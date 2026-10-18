import { getFormatter, setRequestLocale } from "next-intl/server";
import { type ReactNode, Suspense } from "react";

import { DriverShell } from "@/components/driver/driver-shell";
import { LoadingSkeleton } from "@/components/shared/states";
import { createAppFormatters } from "@/lib/format";
import { requirePageActor } from "@/server/auth/page-guards";
import { getFactoryTimezone } from "@/server/settings";

async function Gate({ locale, children }: { locale: string; children: ReactNode }) {
  // Everything in this route group (not the login page) needs a driver or an admin (support view).
  const actor = await requirePageActor("driver", locale);
  const formatters = createAppFormatters(
    await getFormatter({ locale }),
    await getFactoryTimezone(),
  );
  return (
    <DriverShell
      dateLabel={formatters.dateLong(new Date())}
      // The offline copy (NUD-081) belongs to a driver; an admin in the support view has no tour.
      syncUserId={actor.role === "DRIVER" ? actor.id : undefined}
    >
      {children}
    </DriverShell>
  );
}

export default async function DriverLayout({ children, params }: LayoutProps<"/[locale]/driver">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense
      fallback={
        <div className="p-4">
          <LoadingSkeleton />
        </div>
      }
    >
      <Gate locale={locale}>{children}</Gate>
    </Suspense>
  );
}
