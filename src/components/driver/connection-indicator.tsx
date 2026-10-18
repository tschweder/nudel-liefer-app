"use client";

import { WifiIcon, WifiOffIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { useOnline } from "@/lib/offline/use-online";

/**
 * Header indicator: the browser's online state. The detailed offline state ("last updated",
 * "ready offline") is shown by `OfflineStatusBar` (NUD-081); the queue state comes with NUD-082.
 */
export function ConnectionIndicator() {
  const t = useTranslations("driver.shell");
  const online = useOnline();
  const Icon = online ? WifiIcon : WifiOffIcon;
  return (
    <span
      role="status"
      data-testid="connection-indicator"
      data-online={online}
      className="flex items-center gap-1.5 text-base"
    >
      <Icon className="size-5 shrink-0" aria-hidden />
      <span>{online ? t("connectionOnline") : t("connectionOffline")}</span>
    </span>
  );
}
