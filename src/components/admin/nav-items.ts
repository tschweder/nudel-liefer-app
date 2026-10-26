import {
  ClipboardListIcon,
  LayoutDashboardIcon,
  type LucideIcon,
  PackageIcon,
  RouteIcon,
  SettingsIcon,
  StoreIcon,
  TruckIcon,
} from "lucide-react";

export const ADMIN_SECTIONS = [
  "dashboard",
  "orders",
  "tours",
  "customers",
  "products",
  "drivers",
  "settings",
] as const;
export type AdminSection = (typeof ADMIN_SECTIONS)[number];

/** Sidebar groups (re-design.md §8.1): Betrieb / Stammdaten / System. */
export const ADMIN_NAV_GROUPS = [
  { id: "operations", sections: ["dashboard", "orders", "tours"] },
  { id: "masterData", sections: ["customers", "products", "drivers"] },
  { id: "system", sections: ["settings"] },
] as const satisfies ReadonlyArray<{
  id: "operations" | "masterData" | "system";
  sections: ReadonlyArray<AdminSection>;
}>;

export type AdminNavGroupId = (typeof ADMIN_NAV_GROUPS)[number]["id"];

/** Locale-less paths (the i18n navigation helpers add the locale prefix). */
export const ADMIN_NAV: ReadonlyArray<{ section: AdminSection; href: string; icon: LucideIcon }> = [
  { section: "dashboard", href: "/admin", icon: LayoutDashboardIcon },
  { section: "orders", href: "/admin/orders", icon: ClipboardListIcon },
  { section: "tours", href: "/admin/tours", icon: RouteIcon },
  { section: "customers", href: "/admin/customers", icon: StoreIcon },
  { section: "products", href: "/admin/products", icon: PackageIcon },
  { section: "drivers", href: "/admin/drivers", icon: TruckIcon },
  { section: "settings", href: "/admin/settings", icon: SettingsIcon },
];

/** The dashboard only matches exactly; other sections also match their sub-pages. */
export function isNavActive(href: string, pathname: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Nav entry (href + icon) of one section, in membership order. */
export function navItem(section: AdminSection) {
  const item = ADMIN_NAV.find((entry) => entry.section === section);
  if (!item) throw new Error(`Unreachable: no nav item for section ${section}`);
  return item;
}

/**
 * Section the current path belongs to; the dashboard is the fallback so the shell always has a
 * breadcrumb without reading any data (re-design.md §8.1/§14.3).
 */
export function activeNavItem(pathname: string) {
  return ADMIN_NAV.find((entry) => isNavActive(entry.href, pathname)) ?? navItem("dashboard");
}
