"use client";

import { WifiIcon, WifiOffIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { useOnline } from "@/lib/offline/use-online";

/**
 * The browser's online state as an accessibility marker. The visible sync state is the
 * `SyncStatusChip`, which is fed from the same hooks; this element keeps the `data-online` attribute
 * and the localized "Online"/"Offline" text that the driver specs and the offline screens assert
 * (`driver-offline.spec.ts` reads `data-online="false"` after the network is cut). It is rendered
 * inside the top bar's `sr-only` marker so the bar does not repeat the chip's text twice.
 */
export function ConnectionIndicator() {
  const t = useTranslations("driver.shell");
  const online = useOnline();
  const Icon = online ? WifiIcon : WifiOffIcon;
  return (
    <span role="status" data-testid="connection-indicator" data-online={online}>
      <Icon className="size-5 shrink-0" aria-hidden />
      <span>{online ? t("connectionOnline") : t("connectionOffline")}</span>
    </span>
  );
}
