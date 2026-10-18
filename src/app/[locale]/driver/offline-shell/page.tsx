import { setRequestLocale } from "next-intl/server";

import { OfflineDriverApp } from "@/components/driver/offline-driver-app";
import { getMapTileConfig } from "@/lib/map-config";

/**
 * The driver app without a server round trip (NUD-081). This page is public and prerendered per
 * locale, contains NO personal data and is precached by the service worker, which answers driver
 * page loads of `/driver` and `/driver/stops/<id>` with it when the network is down. In the
 * browser `OfflineDriverApp` reads the tour from IndexedDB and renders the same screens as the
 * server pages. Opened while online it is just a (useless but harmless) page of the same app.
 */
export default async function OfflineShellPage({
  params,
}: PageProps<"/[locale]/driver/offline-shell">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <OfflineDriverApp tiles={getMapTileConfig()} />;
}
