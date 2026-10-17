"use client";

import { useTranslations } from "next-intl";

import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

import { ADMIN_NAV, isNavActive } from "./nav-items";

/** Sidebar navigation; the current section gets `aria-current="page"` plus a visible marker. */
export function AdminNav({ onNavigate }: { onNavigate?: () => void }) {
  const t = useTranslations("admin");
  const pathname = usePathname();
  return (
    <nav aria-label={t("shell.mainNavigation")} data-testid="admin-nav">
      <ul className="flex flex-col gap-1">
        {ADMIN_NAV.map(({ section, href, icon: Icon }) => {
          const active = isNavActive(href, pathname);
          return (
            <li key={section}>
              <Link
                href={href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                data-testid={`nav-${section}`}
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded-md border-s-4 px-3 text-base outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "border-primary bg-accent font-semibold text-accent-foreground"
                    : "border-transparent",
                )}
              >
                <Icon className="size-5 shrink-0" aria-hidden />
                {t(`nav.${section}`)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
