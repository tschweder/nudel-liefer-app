"use client";

import { UploadCloudIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { useOutbox } from "@/lib/offline/outbox-browser";

/**
 * Number of taps waiting on the device to be sent (NUD-082), in the driver top bar. Hidden when
 * the queue is empty, so a driver with a good connection never sees it for longer than a moment.
 */
export function PendingBadge() {
  const t = useTranslations("driver.sync");
  const { entries, failure } = useOutbox();
  if (entries.length === 0) return null;
  const label = t("pending", { count: entries.length });
  return (
    <span
      role="status"
      aria-label={label}
      title={failure ? `${label} (${t("willRetry")})` : label}
      data-testid="pending-badge"
      data-count={entries.length}
      className="flex min-h-9 min-w-9 items-center justify-center gap-1 rounded-full bg-amber-500 px-2.5 text-base font-bold text-amber-950 tabular-nums"
    >
      <UploadCloudIcon className="size-5 shrink-0" aria-hidden />
      <span data-testid="pending-count">{entries.length}</span>
    </span>
  );
}
