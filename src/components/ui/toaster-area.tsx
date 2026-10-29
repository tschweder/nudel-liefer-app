"use client";

import { usePathname } from "@/i18n/navigation";

import { Toaster } from "./sonner";

/**
 * NUD-176 (QA 2026-10-29, F1 + F2): ONE toast host for both apps, placed where the app needs it.
 *
 * The driver app has a sticky 56 px header with the date, the sync pill and the stop counter, and a
 * sticky action bar at the bottom. With the default `top-right` position sonner's 32 px offset sat
 * inside the header, so every confirmation covered the very information the driver needs — and the
 * "Rückgängig" button of a completed stop was in the DOM but not clickable (the report could not
 * reach it, and neither could the e2e click).
 *
 * The driver therefore gets `bottom-center` above its action bar; the office keeps `top-right`.
 * The area is derived from the path instead of being passed in, because the host is mounted once in
 * the root layout (a second host would render every toast twice).
 */
export function ToasterArea() {
  const pathname = usePathname();
  const isDriver = pathname?.startsWith("/driver") ?? false;
  return isDriver ? (
    // 96 px clears the two-button action bar (Geliefert / Problem) plus the safe-area padding.
    <Toaster position="bottom-center" offset={{ bottom: 96 }} mobileOffset={{ bottom: 96 }} />
  ) : (
    <Toaster position="top-right" offset={{ top: 72 }} />
  );
}
