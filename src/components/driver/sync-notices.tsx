"use client";

import { InfoIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { getOutbox, useOutbox } from "@/lib/offline/outbox-browser";

const KNOWN = new Set([
  "changed_by_office",
  "not_found",
  "already_completed",
  "not_completed",
  "undo_expired",
  "tour_completed",
  "tour_not_active",
]);

/**
 * Taps the server did not apply because its state won (NUD-082): the office changed the stop,
 * removed it, the tour is no longer active ... Each notice stays until the driver acknowledges it,
 * also across reloads (it is kept in IndexedDB).
 */
export function SyncNotices() {
  const t = useTranslations("driver.sync");
  const { notices } = useOutbox();
  if (notices.length === 0) return null;
  return (
    <div className="space-y-3" data-testid="sync-notices">
      {notices.map((notice) => (
        <div
          key={notice.id}
          role="alert"
          className="space-y-2 rounded-xl border-2 border-amber-500 bg-amber-50 p-4 text-amber-950 dark:bg-amber-950/40 dark:text-amber-50"
          data-testid="sync-notice"
          data-error={notice.error}
          data-stop-id={notice.stopId}
        >
          <p className="flex items-start gap-2 text-base font-semibold">
            <InfoIcon className="mt-0.5 size-5 shrink-0" aria-hidden />
            <span>
              {t(`notices.${KNOWN.has(notice.error) ? notice.error : "generic"}`, {
                name: notice.customerName,
              })}
            </span>
          </p>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="h-12 w-full text-base"
            onClick={() => void getOutbox().dismissNotice(notice.id)}
            data-testid="sync-notice-dismiss"
          >
            {t("dismiss")}
          </Button>
        </div>
      ))}
    </div>
  );
}
