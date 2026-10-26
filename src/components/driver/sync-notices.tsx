"use client";

import { InfoIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { getOutbox, useOutbox } from "@/lib/offline/outbox-browser";

const KNOWN_PHOTO = new Set(["not_found", "tour_not_active", "upload_failed"]);

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
 * Taps (NUD-082) and photos (NUD-083) the server did not take because its state won: the office
 * changed the stop, removed it, the tour is no longer active ... Each notice stays until the driver
 * acknowledges it, also across reloads (it is kept in IndexedDB). Restyled to the warning tokens
 * (re-design.md §7.6, "red strip / amber strip" vocabulary); ids and copy are unchanged.
 */
export function SyncNotices() {
  const t = useTranslations("driver.sync");
  const { notices } = useOutbox();
  if (notices.length === 0) return null;
  return (
    <div className="flex flex-col gap-3" data-testid="sync-notices">
      {notices.map((notice) => (
        <div
          key={notice.id}
          role="alert"
          className="flex flex-col gap-2 rounded-xl bg-warning-soft p-4 text-warning-soft-foreground"
          data-testid="sync-notice"
          data-error={notice.error}
          data-stop-id={notice.stopId}
        >
          <p className="flex items-start gap-2 text-base font-semibold">
            <InfoIcon className="mt-0.5 size-5 shrink-0" aria-hidden />
            <span className="min-w-0">
              {notice.type === "photo"
                ? t(`photoNotices.${KNOWN_PHOTO.has(notice.error) ? notice.error : "generic"}`, {
                    name: notice.customerName,
                  })
                : t(`notices.${KNOWN.has(notice.error) ? notice.error : "generic"}`, {
                    name: notice.customerName,
                  })}
            </span>
          </p>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="w-full"
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
