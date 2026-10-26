import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { type ReactNode, Suspense } from "react";

import { LogoutButton } from "@/components/auth/logout-button";
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
  const t = await getTranslations({ locale, namespace: "driver" });
  return (
    <DriverShell
      dateLabel={formatters.dateShort(new Date())}
      // The offline copy (NUD-081) belongs to a driver; an admin in the support view has no tour.
      syncUserId={actor.role === "DRIVER" ? actor.id : undefined}
      // Overflow menu actions (re-design.md §7.1): greeting + logout; the home empty state repeats
      // the logout as its only visible action.
      logout={
        <div className="flex flex-col gap-2">
          <p className="text-base" data-testid="signed-in-as">
            {t("home.welcome", { name: actor.name })}
          </p>
          <LogoutButton locale={locale} />
        </div>
      }
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
