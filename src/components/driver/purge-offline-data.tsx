"use client";

import { useEffect } from "react";

import { purgeOfflineData } from "@/lib/offline/browser";

/**
 * Rendered on the login pages (NUD-081). Whoever sees a login page has no session, so no personal
 * offline copy may remain: the tour JSON (IndexedDB) and the photos (Cache Storage) are deleted.
 * This covers logout, a session the server ended and a different driver signing in on the phone.
 */
export function PurgeOfflineData() {
  useEffect(() => {
    purgeOfflineData().catch((error) => {
      console.warn("Could not remove the offline copy", error);
    });
  }, []);
  return null;
}
