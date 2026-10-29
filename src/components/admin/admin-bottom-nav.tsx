"use client";

import { useTranslations } from "next-intl";

import { MobileNav } from "@/components/admin/mobile-nav";
import { type AdminSection, isNavActive, navItem } from "@/components/admin/nav-items";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/** The daily sections get a tab; everything else stays one tap away behind "Mehr". */
const TAB_SECTIONS: ReadonlyArray<AdminSection> = ["dashboard", "orders", "tours", "customers"];

/**
 * Bottom navigation of the office screens on a phone or tablet (colour refresh 2026-10). Below the
 * rail breakpoint the sidebar is a drawer; the four daily sections sit in a floating bar at the
 * thumb instead of two taps away. Same breakpoint as `MobileNav` (`min-[1025px]:hidden`), tabs are
 * 48 px touch targets, the active tab carries `aria-current="page"`.
 */
export function AdminBottomNav() {
  const t = useTranslations("admin");
  const pathname = usePathname();
  return (
    <nav
      aria-label={t("shell.bottomNavigation")}
      data-testid="admin-bottom-nav"
      className="fixed inset-x-3 bottom-3 z-30 flex gap-1 rounded-2xl bg-card p-1.5 shadow-lg min-[1025px]:hidden"
      style={{ paddingBottom: "max(0.375rem, env(safe-area-inset-bottom))" }}
    >
      {TAB_SECTIONS.map((section) => {
        const { href, icon: Icon } = navItem(section);
        const active = isNavActive(href, pathname);
        return (
          <Link
            key={section}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "bg-primary-soft text-primary-soft-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-5" aria-hidden />
            <span className="max-w-full truncate px-1">{t(`nav.${section}`)}</span>
          </Link>
        );
      })}
      <MobileNav variant="tab" />
    </nav>
  );
}
