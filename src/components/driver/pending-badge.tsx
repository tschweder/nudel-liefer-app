"use client";

import { UploadCloudIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { useOutbox } from "@/lib/offline/outbox-browser";
import { usePhotoOutbox } from "@/lib/offline/photo-outbox-browser";

/**
 * Queue counter of the driver top bar (NUD-082, NUD-083). The redesign replaces the yellow count
 * badge with the `SyncStatusChip` (state `pending` + count) and the Outbox sheet; this element stays
 * in the tree as the accessible count marker the specs read (`data-count`), visually hidden so a
 * good connection never shows two counters at once.
 */
export function PendingBadge() {
  const t = useTranslations("driver.sync");
  const { entries: taps, failure: tapFailure } = useOutbox();
  const { entries: photos, failure: photoFailure } = usePhotoOutbox();
  const count = taps.length + photos.length;
  const failure = tapFailure ?? photoFailure;
  if (count === 0) return null;
  const label = t("pending", { count });
  return (
    <span
      role="status"
      aria-label={label}
      title={failure ? `${label} (${t("willRetry")})` : label}
      data-testid="pending-badge"
      data-count={count}
      className="sr-only"
    >
      <UploadCloudIcon className="size-5 shrink-0" aria-hidden />
      <span data-testid="pending-count">{count}</span>
    </span>
  );
}
