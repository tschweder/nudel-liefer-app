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
