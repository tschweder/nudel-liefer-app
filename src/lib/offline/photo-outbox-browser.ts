import { useSyncExternalStore } from "react";

import { newClientMutationId } from "@/lib/client-id";

import { getOutbox, registerBackgroundSync } from "./outbox-browser";
import { createIndexedDbOutboxStore } from "./outbox-store";
import {
  createPhotoOutboxController,
  type NewPhoto,
  type PhotoOutboxController,
  type PhotoOutboxState,
} from "./photo-outbox-controller";
import { createIndexedDbPhotoStore } from "./photo-outbox-store";
import { createBrowserPhotoCache } from "./photos";

/**
 * Browser wiring of the queued driver photos (NUD-083): one controller per tab on top of the shared
 * IndexedDB, the React hook, and the Background Sync registration (the status outbox tag also
 * flushes photos in the worker). Notices share the notice store of the status outbox, so the same
 * "could not be applied" cards show them.
 */

let controller: PhotoOutboxController | null = null;

export function getPhotoOutbox(): PhotoOutboxController {
  if (controller) return controller;
  const notices = createIndexedDbOutboxStore();
  const photoCache = createBrowserPhotoCache();
  controller = createPhotoOutboxController({
    store: createIndexedDbPhotoStore(),
    putNotice: async (notice) => {
      await notices.putNotice(notice);
      // The notice list lives in the status outbox state: show the new card.
      await getOutbox().reload();
    },
    cachePhoto: (photoId, blob) =>
      photoCache.put(
        photoId,
        new Response(blob, { headers: { "Content-Type": blob.type || "image/jpeg" } }),
      ),
    // No `navigator.onLine` gate anywhere: it can be wrong; a failed fetch is cheap.
    fetchImpl: (input, init) => fetch(input, init),
    now: () => new Date(),
    newId: newClientMutationId,
  });
  return controller;
}

const SERVER_STATE: PhotoOutboxState = {
  userId: null,
  entries: [],
  inFlight: new Set(),
  flushing: false,
  failure: null,
  confirmed: {},
};

/** The photo queue in React (queued photos, just confirmed ones). Empty during server rendering. */
export function usePhotoOutbox(): PhotoOutboxState {
  return useSyncExternalStore(
    (listener) => getPhotoOutbox().subscribe(listener),
    () => getPhotoOutbox().getState(),
    () => SERVER_STATE,
  );
}

/** Queues a photo, then tries to send right away (the backoff decides if that happens). */
export async function enqueuePhoto(photo: NewPhoto) {
  const entry = await getPhotoOutbox().enqueue(photo);
  void registerBackgroundSync();
  void getPhotoOutbox().flush();
  return entry;
}
