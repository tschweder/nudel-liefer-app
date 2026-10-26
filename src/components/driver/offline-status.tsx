"use client";

import { CloudAlertIcon, WifiOffIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { createAppFormatters } from "@/lib/format";
import { useOfflineStatus } from "@/lib/offline/browser";
import { useOnline } from "@/lib/offline/use-online";

/**
 * Offline state of the driver app (NUD-081) as thin banners above the content: offline an amber
 * strip "Offline – Daten vom 07:12. Du kannst weiterarbeiten.", online a warning line while only some
 * of the photos are stored. The vocabulary of the five sync states lives in the top bar's chip
 * (re-design.md §7.6) — "ready offline" and "being saved for offline" are states of that chip, so
 * this component only reports the copy state and keeps the test ids the offline/outbox specs assert
 * (`offline-bar`, `offline-partial`, `offline-error`).
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
        className="flex items-center gap-2 rounded-lg bg-warning-soft px-3 py-2 text-base font-medium text-warning-soft-foreground"
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
    // The "ready offline" state lives in the SyncStatusChip now (re-design.md §7.6): the chip's
    // marker in the top bar carries the same text, so no second line is rendered here.
    return null;
  }
  // "Tour wird für offline gespeichert …" is no longer a strip of its own either (design review,
  // point 2): the chip in the top bar carries that state (`preparing`), and the strip only pushed
  // the hero card — and with it the primary CTA — below the fold at 375 x 667.
  if (status.syncing) return null;
  if (status.phase === "partial" && hasCopy && !status.syncing) {
    return (
      <p
        role="status"
        className="flex items-center gap-2 rounded-lg bg-warning-soft px-3 py-2 text-base font-medium text-warning-soft-foreground"
        data-testid="offline-partial"
      >
        <CloudAlertIcon className="size-5 shrink-0" aria-hidden />
        {t("partial", { cached: status.photos.cached, total: status.photos.total })}
      </p>
    );
  }
  if (status.phase === "error") {
    return (
      <p
        role="status"
        className="flex items-center gap-2 rounded-lg bg-warning-soft px-3 py-2 text-base font-medium text-warning-soft-foreground"
        data-testid="offline-error"
      >
        <CloudAlertIcon className="size-5 shrink-0" aria-hidden />
        {t("error")}
      </p>
    );
  }
  return null;
}
