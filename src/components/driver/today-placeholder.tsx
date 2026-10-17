import { useTranslations } from "next-intl";

import { LogoutButton } from "@/components/auth/logout-button";
import { EmptyState } from "@/components/shared/states";

/** Placeholder "Heute" content until the real tour screen (NUD-051). */
export function TodayPlaceholder({ name, locale }: { name: string; locale: string }) {
  const t = useTranslations("driver");
  return (
    <>
      <h1 className="text-3xl font-semibold" data-testid="driver-title">
        {t("home.title")}
      </h1>
      <p className="text-base" data-testid="signed-in-as">
        {t("home.welcome", { name })}
      </p>
      <EmptyState title={t("today.emptyTitle")} description={t("today.emptyDescription")} />
      <LogoutButton locale={locale} />
    </>
  );
}
