"use client";

import { useEffect } from "react";

import { useRouter } from "@/i18n/navigation";
import { loadOfflineStatus, syncOfflineNow } from "@/lib/offline/browser";

const REFRESH_INTERVAL_MS = 5 * 60_000;
const RETRY_DELAYS_MS = [3_000, 10_000, 30_000];

/**
 * Keeps the offline copy of today's tour current while the driver app is open (NUD-081, renders
 * nothing): on start, when the connection comes back, when the app becomes visible again and every
 * few minutes. After a reconnect the server pages are refreshed too ("online again: refresh in the
 * background"). Mounted for DRIVER users only; the sync itself never blocks the screen.
 */
export function OfflineSync({ userId }: { userId: string }) {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    const timers = new Set<ReturnType<typeof setTimeout>>();

    async function sync(attempt = 0): Promise<boolean> {
      // No `navigator.onLine` gate: it can be wrong (it is false on some Linux setups without a
      // network manager) and an offline fetch fails immediately anyway.
      if (cancelled) return false;
      const ok = await syncOfflineNow(userId);
      if (!ok && !cancelled && attempt < RETRY_DELAYS_MS.length) {
        // Right after "online" the network is often not usable yet: try again shortly.
        const timer = setTimeout(() => {
          timers.delete(timer);
          void sync(attempt + 1);
        }, RETRY_DELAYS_MS[attempt]);
        timers.add(timer);
      }
      return ok;
    }

    void loadOfflineStatus(userId);
    void sync();

    const onOnline = () => void sync().then((ok) => ok && !cancelled && router.refresh());
    const onVisible = () => {
      if (document.visibilityState === "visible") void sync();
    };
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void sync();
    }, REFRESH_INTERVAL_MS);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(interval);
      timers.forEach(clearTimeout);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [userId, router]);

  return null;
}
