"use client";

import { useEffect } from "react";

import { useRouter } from "@/i18n/navigation";
import { loadOfflineStatus, requestOfflineSync, syncOfflineNow } from "@/lib/offline/browser";
import { OUTBOX_FLUSHED_MESSAGE } from "@/lib/offline/constants";
import { getOutbox } from "@/lib/offline/outbox-browser";

const REFRESH_INTERVAL_MS = 5 * 60_000;
/** The outbox is looked at this often (a flush with nothing queued costs one IndexedDB read). */
const OUTBOX_INTERVAL_MS = 60_000;
const RETRY_DELAYS_MS = [3_000, 10_000, 30_000];

/**
 * Keeps the offline copy of today's tour current and sends the queued taps while the driver app is
 * open (NUD-081 / NUD-082, renders nothing).
 * - Tour copy: on start, when the connection comes back, when the app becomes visible again and
 *   every few minutes. After a reconnect the server pages are refreshed too.
 * - Outbox: loaded at start and sent right away, again on the `online` event, when the app gets
 *   focus again (both skip the backoff: the situation just changed) and every 60 s (respects the
 *   exponential backoff). When the worker flushed the queue in the background (Background Sync) it
 *   tells the page, which reloads the queue and refreshes. Never gated on `navigator.onLine`.
 * Mounted for DRIVER users only; nothing here blocks the screen.
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

    const outbox = getOutbox();
    void loadOfflineStatus(userId);
    // Send what an earlier visit left in the queue first: the tour copy then already shows it.
    void outbox
      .start(userId)
      .then(() => outbox.flush({ force: true }))
      .finally(() => void sync());

    // The server settled queued taps: the pages and the offline copy must show its state.
    const offFlushed = outbox.onFlushed(() => {
      if (cancelled) return;
      requestOfflineSync();
      router.refresh();
    });

    const onOnline = () =>
      void outbox
        .flush({ force: true })
        .then(() => sync())
        .then((ok) => ok && !cancelled && router.refresh());
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void outbox.flush({ force: true });
      void sync();
    };
    const onWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type !== OUTBOX_FLUSHED_MESSAGE || cancelled) return;
      void outbox.reload().then(() => {
        requestOfflineSync();
        router.refresh();
      });
    };
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void sync();
    }, REFRESH_INTERVAL_MS);
    const outboxInterval = setInterval(() => void outbox.flush(), OUTBOX_INTERVAL_MS);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    navigator.serviceWorker?.addEventListener("message", onWorkerMessage);
    return () => {
      cancelled = true;
      clearInterval(interval);
      clearInterval(outboxInterval);
      timers.forEach(clearTimeout);
      offFlushed();
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
      navigator.serviceWorker?.removeEventListener("message", onWorkerMessage);
    };
  }, [userId, router]);

  return null;
}
