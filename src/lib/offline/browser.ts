import { useSyncExternalStore } from "react";

import { createBrowserPhotoCache, type PhotoCache } from "./photos";
import { createIndexedDbStore, loadCurrentRecord, type OfflineStore } from "./store";
import { syncDriverTour } from "./sync";

/**
 * Browser wiring of the offline copy (NUD-081): one IndexedDB store, one photo cache, one status
 * that the UI observes. Everything here is best effort: a browser without IndexedDB / Cache
 * Storage (private mode, blocked storage) simply never reports "ready offline".
 */

export type OfflinePhase = "idle" | "ready" | "partial" | "no-tour" | "error";

export type OfflineStatus = {
  /** Result of the last finished sync (or of the stored copy found at start). */
  phase: OfflinePhase;
  /** A sync is running right now. */
  syncing: boolean;
  /** When the stored copy was loaded from the server (ISO), `null` without a copy. */
  savedAt: string | null;
  timezone: string | null;
  photos: { total: number; cached: number };
};

const INITIAL: OfflineStatus = {
  phase: "idle",
  syncing: false,
  savedAt: null,
  timezone: null,
  photos: { total: 0, cached: 0 },
};

let status: OfflineStatus = INITIAL;
const listeners = new Set<() => void>();

function setStatus(next: Partial<OfflineStatus>) {
  status = { ...status, ...next };
  for (const listener of listeners) listener();
}

export function getOfflineStatus(): OfflineStatus {
  return status;
}

export function subscribeOfflineStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Observes the offline status in React. */
export function useOfflineStatus(): OfflineStatus {
  return useSyncExternalStore(subscribeOfflineStatus, getOfflineStatus, () => INITIAL);
}

let store: OfflineStore | null = null;
let photoCache: PhotoCache | null = null;
export const getOfflineStore = () => (store ??= createIndexedDbStore());
export const getPhotoCache = () => (photoCache ??= createBrowserPhotoCache());

let lastUserId: string | null = null;
let running: Promise<boolean> | null = null;
let rerun = false;

async function runSync(userId: string): Promise<boolean> {
  setStatus({ syncing: true });
  const outcome = await syncDriverTour(userId, {
    store: getOfflineStore(),
    photoCache: getPhotoCache(),
    fetchImpl: (input, init) => fetch(input, init),
    now: () => new Date(),
    onStored: (record) =>
      setStatus({ savedAt: record.savedAt, timezone: record.data.timezone, phase: "partial" }),
  });
  switch (outcome.kind) {
    case "saved": {
      const complete = outcome.photos.cached === outcome.photos.total;
      setStatus({
        phase: complete ? "ready" : "partial",
        savedAt: outcome.record.savedAt,
        timezone: outcome.record.data.timezone,
        photos: { total: outcome.photos.total, cached: outcome.photos.cached },
      });
      break;
    }
    case "no-tour":
      setStatus({
        phase: "no-tour",
        savedAt: null,
        timezone: null,
        photos: { total: 0, cached: 0 },
      });
      break;
    case "unauthorized":
      break; // the session ended: keep as is, the login page purges
    case "error":
      // Keep what is stored; without any copy there is nothing to be ready for.
      setStatus({ phase: status.savedAt ? status.phase : "error" });
      break;
  }
  setStatus({ syncing: false });
  return outcome.kind === "saved" || outcome.kind === "no-tour";
}

/**
 * Loads the tour of `userId` into the offline copy (concurrent calls are merged: a request that
 * arrives while a sync runs makes it run once more). Resolves `true` when the last run succeeded.
 */
export async function syncOfflineNow(userId: string): Promise<boolean> {
  lastUserId = userId;
  if (running) {
    rerun = true;
    return running;
  }
  running = (async () => {
    let ok = false;
    try {
      do {
        rerun = false;
        ok = await runSync(userId);
      } while (rerun);
    } finally {
      running = null;
    }
    return ok;
  })();
  return running;
}

/** Refreshes the offline copy for the user the app is running for (e.g. after a status change). */
export function requestOfflineSync(): void {
  if (lastUserId) void syncOfflineNow(lastUserId);
}

/** Shows what a previous visit stored (so "last updated" is known before the first sync ends). */
export async function loadOfflineStatus(userId?: string): Promise<void> {
  try {
    const record = await loadCurrentRecord(getOfflineStore(), new Date(), userId);
    if (record && !running) {
      setStatus({ savedAt: record.savedAt, timezone: record.data.timezone, phase: "partial" });
    }
  } catch {
    // no storage: nothing to show
  }
}

/**
 * Removes every personal offline copy: the tour JSON in IndexedDB and the photos in Cache
 * Storage. Called when the login page is shown (logout, expired or ended session). Each part is
 * attempted even if the other fails.
 */
export async function purgeOfflineData(): Promise<void> {
  lastUserId = null;
  const results = await Promise.allSettled([getOfflineStore().clear(), getPhotoCache().clear()]);
  setStatus({ ...INITIAL });
  const failed = results.find((r) => r.status === "rejected");
  if (failed && failed.status === "rejected") throw failed.reason;
}
