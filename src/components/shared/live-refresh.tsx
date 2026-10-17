"use client";

import { useEffect } from "react";

import { useRouter } from "@/i18n/navigation";

/**
 * Keeps a server-rendered screen current (NUD-054): calls `router.refresh()` every `intervalMs`
 * while `enabled` and the tab is visible. No websockets; the server components re-read the
 * database. When the tab becomes visible again it refreshes at once instead of waiting.
 */
export function LiveRefresh({
  intervalMs,
  enabled = true,
}: {
  intervalMs: number;
  enabled?: boolean;
}) {
  const router = useRouter();
  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      if (document.visibilityState !== "hidden") router.refresh();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const timer = window.setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, intervalMs, router]);
  return <span hidden data-testid="live-refresh" data-interval-ms={intervalMs} />;
}
