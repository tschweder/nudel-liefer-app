import { useTranslations } from "next-intl";

import { EmptyState } from "@/components/shared/states";

import type { AdminSection } from "./nav-items";

/** Body of a not-yet-built admin section. */
export function SectionPlaceholder({ section }: { section: AdminSection }) {
  const t = useTranslations();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl font-semibold" data-testid="section-title">
        {t(`admin.nav.${section}`)}
      </h1>
      <EmptyState description={t("common.states.comingSoon")} />
    </div>
  );
}
