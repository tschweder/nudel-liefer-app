"use client";

import { useTranslations } from "next-intl";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

import { ADMIN_NAV_GROUPS, isNavActive, navItem } from "./nav-items";

/**
 * Sidebar navigation (re-design.md §8.1): grouped by Betrieb / Stammdaten / System, the current
 * section as a `primary-soft` pill. In the collapsed 72 px rail the group labels disappear and the
 * label moves into a tooltip; every row is a real link with `aria-current="page"` when active.
 */
export function AdminNav({
  onNavigate,
  collapsed = false,
}: {
  onNavigate?: () => void;
  /** Icon rail mode (desktop sidebar collapsed); labels are shown in tooltips instead. */
  collapsed?: boolean;
}) {
  const t = useTranslations("admin");
  const pathname = usePathname();

  return (
    <nav
      aria-label={t("shell.mainNavigation")}
      data-testid="admin-nav"
      data-collapsed={collapsed ? "" : undefined}
      className="flex min-h-0 flex-col gap-4 overflow-y-auto"
    >
      {ADMIN_NAV_GROUPS.map((group) => (
        <div key={group.id} className="flex flex-col gap-1">
          {collapsed ? (
            <span aria-hidden className="mx-3 border-t border-border" />
          ) : (
            <p className="px-3 text-xs font-medium text-muted-foreground">
              {t(`nav.groups.${group.id}`)}
            </p>
          )}
          <ul className="flex flex-col gap-0.5">
            {group.sections.map((section) => {
              const { href, icon: Icon } = navItem(section);
              const active = isNavActive(href, pathname);
              const label = t(`nav.${section}`);
              const link = (
                <Link
                  href={href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  aria-label={collapsed ? label : undefined}
                  title={collapsed ? label : undefined}
                  data-testid={`nav-${section}`}
                  className={cn(
                    "flex h-10 items-center gap-3 rounded-lg px-3 text-base outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
                    collapsed && "justify-center px-0",
                    active
                      ? "bg-primary-soft font-semibold text-primary-soft-foreground"
                      : "text-foreground",
                  )}
                >
                  <Icon className="size-5 shrink-0" aria-hidden />
                  {collapsed ? null : <span className="truncate">{label}</span>}
                </Link>
              );
              return (
                <li key={section}>
                  {collapsed ? (
                    <Tooltip>
                      <TooltipTrigger asChild>{link}</TooltipTrigger>
                      <TooltipContent side="right">{label}</TooltipContent>
                    </Tooltip>
                  ) : (
                    link
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
