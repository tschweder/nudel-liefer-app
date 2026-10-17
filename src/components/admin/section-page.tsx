import { setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import { LoadingSkeleton } from "@/components/shared/states";
import { requirePageActor } from "@/server/auth/page-guards";

import type { AdminSection } from "./nav-items";
import { SectionPlaceholder } from "./section-placeholder";

async function Guarded({ locale, section }: { locale: string; section: AdminSection }) {
  // Defence in depth behind the proxy and the admin layout (layouts are not re-run on client navigation).
  await requirePageActor("admin", locale);
  return <SectionPlaceholder section={section} />;
}

/** Page for a placeholder admin section: role-checked on the server, then the placeholder. */
export function AdminSectionPage({ locale, section }: { locale: string; section: AdminSection }) {
  setRequestLocale(locale);
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <Guarded locale={locale} section={section} />
    </Suspense>
  );
}
