/**
 * Maps message-key prefixes to the screen where the text is visible, so reviewers can find the
 * text in the running app. The most specific (longest) matching prefix wins.
 *
 * Maintenance: when a ticket adds a new key namespace, add one line here. Routes are written
 * WITHOUT the locale segment; prepend `/<locale>` (e.g. `/zh-Hans/admin/orders/new`).
 * `[id]` / `[stopId]` stand for a real record id. A text in parentheses is a description, not a URL.
 * The unit test fails when a prefix below matches no key any more (stale entry).
 */
export const ROUTE_HINTS: ReadonlyArray<readonly [prefix: string, hint: string]> = [
  // shared
  ["common.appName", "(shared: page header and browser tab, every screen)"],
  ["common.language", "(shared: language switcher, every screen)"],
  ["common.actions", "(shared: buttons on many screens)"],
  ["common.units", "(shared: product units, e.g. /admin/orders/new)"],
  ["common.statuses", "(shared: status badges, e.g. /admin/orders and /admin/tours)"],
  ["common.problemReasons", "(shared: problem reasons, /driver/stops/[stopId] and /admin/tours)"],
  ["common.errors", "(shared: error messages in forms)"],
  ["common.itemsCount", "/admin/orders"],
  ["common.states", "(shared: empty / loading / error states)"],
  ["common.notFound", "(any unknown URL, e.g. /admin/does-not-exist)"],
  ["common.error", "(error page, shown when a screen crashes)"],
  ["common.upload", "/admin/customers/[id] (photo upload)"],
  ["common", "(shared)"],
  ["home", "/"],
  ["pwa.name", "(app name on the home screen, from the web app manifest)"],
  ["pwa.shortName", "(app name on the home screen, from the web app manifest)"],
  ["pwa.description", "(web app manifest, not visible on a screen)"],
  ["pwa.offline", "(offline fallback page /offline.html; open /driver with the network off)"],
  // error pages (NUD-094; open the hidden test pages with ENABLE_ERROR_TEST_PAGES=true)
  [
    "errorPages.driver",
    "/driver/dev-error (driver error page; offline wording: switch to airplane mode first)",
  ],
  ["errorPages.admin", "/admin/dev/error (admin error page)"],
  ["errorPages.fatal", "(last-resort page when the whole app fails to render; hard to trigger)"],
  // login
  ["auth.adminLogin", "/login"],
  ["auth.driverLogin", "/driver/login"],
  ["auth", "/login and /driver/login"],
  // admin
  ["admin.shell", "/admin (header and menu)"],
  ["admin.nav", "/admin (side navigation)"],
  ["admin.dashboard", "/admin"],
  ["admin.drivers", "/admin/drivers"],
  ["admin.customers.form", "/admin/customers/new"],
  ["admin.customers.detail", "/admin/customers/[id]"],
  ["admin.customers.translations", "/admin/customers/[id]/edit (notes translations)"],
  ["admin.customers", "/admin/customers"],
  ["admin.products.form", "/admin/products/new"],
  ["admin.products", "/admin/products"],
  ["admin.maps", "/admin/customers/new (map pin)"],
  ["admin.devMaps", "/admin/dev/maps"],
  ["admin.settings", "/admin/settings"],
  ["admin.orders.form", "/admin/orders/new"],
  ["admin.orders.detail", "/admin/orders/[id]"],
  ["admin.orders", "/admin/orders"],
  ["admin.tours", "/admin/tours"],
  ["admin", "/admin"],
  // driver
  ["driver.home", "/driver"],
  ["driver.shell", "/driver (header and connection bar)"],
  ["driver.today", "/driver"],
  ["driver.units", "/driver and /driver/stops/[stopId]"],
  ["driver.stop", "/driver/stops/[stopId]"],
  [
    "driver.install",
    "/driver (install hint above the content; on iOS also the instructions overlay)",
  ],
  ["driver.status", "/driver/stops/[stopId] (delivered / problem buttons)"],
  ["driver", "/driver"],
];

/** Returns the screen hint for a message key, or "" when no prefix matches. */
export function routeHint(key: string): string {
  let best: readonly [string, string] | undefined;
  for (const entry of ROUTE_HINTS) {
    const [prefix] = entry;
    if (
      (key === prefix || key.startsWith(`${prefix}.`)) &&
      (!best || prefix.length > best[0].length)
    ) {
      best = entry;
    }
  }
  return best ? best[1] : "";
}
