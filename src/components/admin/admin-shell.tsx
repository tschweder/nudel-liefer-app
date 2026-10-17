import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { AdminNav } from "@/components/admin/admin-nav";
import { MobileNav } from "@/components/admin/mobile-nav";
import { UserMenu } from "@/components/admin/user-menu";
import { LanguageSwitcher } from "@/components/shared/language-switcher";

/** Desktop-first admin layout: sidebar (slide-over on small screens) + header + content. */
export function AdminShell({
  name,
  locale,
  children,
}: {
  name: string;
  locale: string;
  children: ReactNode;
}) {
  const t = useTranslations();
  return (
    <div className="flex min-h-dvh" data-testid="admin-shell">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-background px-3 py-2 focus:not-sr-only focus:absolute focus:start-2 focus:top-2"
      >
        {t("admin.shell.skipToContent")}
      </a>
      <aside className="hidden w-60 shrink-0 flex-col gap-4 border-e bg-card p-3 md:flex">
        <p className="px-3 py-2 text-lg font-semibold">{t("common.appName")}</p>
        <AdminNav />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background px-4">
          <MobileNav />
          <div className="ms-auto flex items-center gap-2">
            <LanguageSwitcher variant="compact" />
            <UserMenu name={name} locale={locale} />
          </div>
        </header>
        <main id="main" className="min-w-0 flex-1 p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
