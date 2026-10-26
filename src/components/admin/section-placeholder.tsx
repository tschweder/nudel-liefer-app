import { useTranslations } from "next-intl";

import { EmptyState } from "@/components/shared/states";

import type { AdminSection } from "./nav-items";
import { PageHeader } from "./page-header";

/** Body of a not-yet-built admin section; uses the shared page header like every admin page. */
export function SectionPlaceholder({ section }: { section: AdminSection }) {
  const t = useTranslations();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t(`admin.nav.${section}`)} />
      <EmptyState description={t("common.states.comingSoon")} />
    </div>
  );
}
