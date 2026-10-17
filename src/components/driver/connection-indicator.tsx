"use client";

import { WifiIcon, WifiOffIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";

function subscribe(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

/**
 * Placeholder for the connection indicator: shows the browser's online state only.
 * The offline queue / sync state arrives with NUD-081/082.
 */
export function ConnectionIndicator() {
  const t = useTranslations("driver.shell");
  const online = useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
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
