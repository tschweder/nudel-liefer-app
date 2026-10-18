"use client";

import { CheckCircle2Icon, CloudAlertIcon, LoaderCircleIcon, WifiOffIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { createAppFormatters } from "@/lib/format";
import { useOfflineStatus } from "@/lib/offline/browser";
import { useOnline } from "@/lib/offline/use-online";

/**
 * Offline state of the driver app (NUD-081): while offline an amber bar "offline - last updated
 * 07:12"; while online a chip "ready offline" once the tour and ALL its photos are stored (a
 * partial state names the missing photos instead of claiming readiness).
 */
export function OfflineStatusBar() {
  const t = useTranslations("driver.offline");
  const formatter = useFormatter();
  const online = useOnline();
  const status = useOfflineStatus();
  const fmt = createAppFormatters(formatter, status.timezone ?? undefined);
  const hasCopy = status.savedAt !== null;

  if (!online) {
    return (
      <p
        role="status"
        className="flex items-center gap-2 rounded-lg border-2 border-amber-500 bg-amber-50 p-3 text-base font-semibold text-amber-950 dark:bg-amber-950/40 dark:text-amber-50"
        data-testid="offline-bar"
      >
        <WifiOffIcon className="size-5 shrink-0" aria-hidden />
        <span>
          {hasCopy ? t("bar", { time: fmt.time(new Date(status.savedAt!)) }) : t("barNoData")}
        </span>
      </p>
    );
  }

  if (status.phase === "ready" && hasCopy) {
    return (
      <p
        role="status"
        className="flex items-center gap-2 text-base font-medium text-green-800 dark:text-green-400"
        data-testid="offline-ready"
      >
        <CheckCircle2Icon className="size-5 shrink-0" aria-hidden />
        {t("ready")}
      </p>
    );
  }
  if (status.phase === "partial" && hasCopy && !status.syncing) {
    return (
      <p
        role="status"
        className="flex items-center gap-2 text-base font-medium text-amber-900 dark:text-amber-300"
        data-testid="offline-partial"
      >
        <CloudAlertIcon className="size-5 shrink-0" aria-hidden />
        {t("partial", { cached: status.photos.cached, total: status.photos.total })}
      </p>
    );
  }
  if (status.syncing) {
    return (
      <p
        role="status"
        className="flex items-center gap-2 text-base text-muted-foreground"
        data-testid="offline-syncing"
      >
        <LoaderCircleIcon className="size-5 shrink-0 animate-spin" aria-hidden />
        {t("syncing")}
      </p>
    );
  }
  if (status.phase === "error") {
    return (
      <p
        role="status"
        className="flex items-center gap-2 text-base font-medium text-amber-900 dark:text-amber-300"
        data-testid="offline-error"
      >
        <CloudAlertIcon className="size-5 shrink-0" aria-hidden />
        {t("error")}
      </p>
    );
  }
  return null;
}
