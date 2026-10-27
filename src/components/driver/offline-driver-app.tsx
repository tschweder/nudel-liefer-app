"use client";

import { RefreshCwIcon } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useEffect, useState, useSyncExternalStore } from "react";

import { DriverShell } from "@/components/driver/driver-shell";
import { StopDetail } from "@/components/driver/stop-detail";
import { TodayTour } from "@/components/driver/today-tour";
import { EmptyState, LoadingSkeleton } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { toDriverStopDetail, toDriverToday } from "@/lib/driver-tour-model";
import { createAppFormatters } from "@/lib/format";
import type { AppLocale } from "@/lib/localized-text";
import type { MapTileConfig } from "@/lib/map-config";
import { getOfflineStore, loadOfflineStatus } from "@/lib/offline/browser";
import { photoCacheUrl } from "@/lib/offline/constants";
import { getOutbox } from "@/lib/offline/outbox-browser";
import { getPhotoOutbox } from "@/lib/offline/photo-outbox-browser";
import { parseOfflineView } from "@/lib/offline/routes";
import { loadCurrentRecord, type OfflineRecord } from "@/lib/offline/store";

const subscribeNothing = () => () => {};
const readPathname = () => window.location.pathname;

type Loaded = { state: "loading" } | { state: "none" } | { state: "ready"; record: OfflineRecord };

/**
 * The driver screens rendered from the offline copy (NUD-081): the service worker serves this
 * page's shell for `/driver` and `/driver/stops/<id>` while the network is down; the URL says
 * which screen to show, IndexedDB provides the data, the components are the very same as online.
 */
export function OfflineDriverApp({ tiles }: { tiles: MapTileConfig }) {
  const t = useTranslations("driver.offline");
  const locale = useLocale() as AppLocale;
  const formatter = useFormatter();
  // Server HTML has no URL knowledge: render the skeleton first, the real screen after hydration.
  const pathname = useSyncExternalStore(subscribeNothing, readPathname, () => null);
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });

  useEffect(() => {
    let cancelled = false;
    loadCurrentRecord(getOfflineStore(), new Date())
      // The queued taps and photos of this driver are part of what the screens show (NUD-082/083).
      .then(async (record) => {
        if (record) {
          await getOutbox().start(record.userId);
          await getPhotoOutbox().start(record.userId);
        }
        return record;
      })
      .then((record) => {
        if (cancelled) return;
        setLoaded(record ? { state: "ready", record } : { state: "none" });
        void loadOfflineStatus(record?.userId);
      })
      .catch(() => !cancelled && setLoaded({ state: "none" }));
    // The connection is back: leave the shell for the real, current page.
    const onOnline = () => window.location.reload();
    window.addEventListener("online", onOnline);
    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
    };
  }, []);

  const record = loaded.state === "ready" ? loaded.record : null;
  const timezone = record?.data.timezone;
  // Only after loading (prerendering must not read the clock).
  const dateLabel = record ? createAppFormatters(formatter, timezone).dateLong(new Date()) : "";

  let body;
  if (pathname === null || loaded.state === "loading") {
    body = <LoadingSkeleton />;
  } else if (!record) {
    body = (
      <div className="space-y-4" data-testid="offline-empty">
        <EmptyState title={t("noDataTitle")} description={t("noDataDescription")} />
        <Button
          type="button"
          size="lg"
          className="min-h-14 w-full text-lg"
          onClick={() => window.location.reload()}
        >
          <RefreshCwIcon className="size-5" aria-hidden />
          {t("retry")}
        </Button>
      </div>
    );
  } else {
    const view = parseOfflineView(pathname);
    const response = record.data;
    const today = toDriverToday(response, locale);
    const detail =
      view.view === "stop"
        ? toDriverStopDetail(response, view.stopId, locale, (photo) => photoCacheUrl(photo.id))
        : null;
    if (!today) {
      body = <EmptyState title={t("noDataTitle")} description={t("noDataDescription")} />;
    } else if (view.view === "stop") {
      body = detail ? (
        <StopDetail detail={detail} tiles={tiles} offline />
      ) : (
        <div className="space-y-4" data-testid="offline-stop-missing">
          <EmptyState title={t("stopMissingTitle")} description={t("stopMissingDescription")} />
          <Button asChild size="lg" className="min-h-14 w-full text-lg">
            <Link href="/driver">{t("backToTour")}</Link>
          </Button>
        </div>
      );
    } else {
      body = <TodayTour today={today} tiles={tiles} offline />;
    }
  }

  return (
    <DriverShell dateLabel={dateLabel} offline>
      {body}
    </DriverShell>
  );
}
