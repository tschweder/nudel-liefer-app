import { useSyncExternalStore } from "react";

import { newClientMutationId } from "@/lib/client-id";

import { OUTBOX_SYNC_TAG } from "./constants";
import {
  createOutboxController,
  type OutboxController,
  type OutboxState,
} from "./outbox-controller";
import { createIndexedDbOutboxStore } from "./outbox-store";

/**
 * Browser wiring of the outbox (NUD-082): one controller per tab on top of the shared IndexedDB,
 * the React hook, and the Background Sync registration. Everything is best effort: without
 * IndexedDB the queue cannot be written and `enqueueMutation` rejects (the screen then says so).
 */

let controller: OutboxController | null = null;

export function getOutbox(): OutboxController {
  controller ??= createOutboxController({
    store: createIndexedDbOutboxStore(),
    // No `navigator.onLine` gate anywhere: it can be wrong; a failed fetch is cheap.
    fetchImpl: (input, init) => fetch(input, init),
    now: () => new Date(),
    newId: newClientMutationId,
  });
  return controller;
}

const SERVER_STATE: OutboxState = {
  userId: null,
  entries: [],
  inFlight: new Set(),
  notices: [],
  flushing: false,
  failure: null,
  confirmed: {},
};

/** The outbox state in React (queued taps, notices, flushing). Empty during server rendering. */
export function useOutbox(): OutboxState {
  return useSyncExternalStore(
    (listener) => getOutbox().subscribe(listener),
    () => getOutbox().getState(),
    () => SERVER_STATE,
  );
}

/** Registers a one-off Background Sync so the worker can send the queue when the app is closed. */
export async function registerBackgroundSync(): Promise<void> {
  try {
    if (!("serviceWorker" in navigator)) return;
    const registration = await navigator.serviceWorker.ready;
    const sync = (
      registration as ServiceWorkerRegistration & {
        sync?: { register(tag: string): Promise<void> };
      }
    ).sync;
    await sync?.register(OUTBOX_SYNC_TAG);
  } catch {
    // Not supported (Safari, Firefox) or not allowed: the page-side triggers still work.
  }
}

/** Queues a tap, then tries to send right away (the backoff decides if that happens). */
export async function enqueueMutation(
  ...args: Parameters<OutboxController["enqueue"]>
): ReturnType<OutboxController["enqueue"]> {
  const entry = await getOutbox().enqueue(...args);
  void registerBackgroundSync();
  void getOutbox().flush();
  return entry;
}

/** Undo for a stop: cancels the queued completion, or queues an undo. */
export async function undoStopStatus(
  ...args: Parameters<OutboxController["undo"]>
): ReturnType<OutboxController["undo"]> {
  const result = await getOutbox().undo(...args);
  if (result === "queued") {
    void registerBackgroundSync();
    void getOutbox().flush();
  }
  return result;
}
