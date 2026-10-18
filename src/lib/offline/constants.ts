/**
 * Names shared by the page code and the service worker (NUD-081). Keep this file free of
 * imports: the worker bundles it.
 */

/** IndexedDB database holding the driver's tour of today (one record per user). */
export const OFFLINE_DB_NAME = "nudel-driver-offline";
export const OFFLINE_DB_VERSION = 3;
export const OFFLINE_TOURS_STORE = "tours";
/** Mutation outbox (NUD-082): queued stop-status taps, keyed by `clientMutationId`. */
export const OFFLINE_OUTBOX_STORE = "outbox";
/** Photos the driver took (NUD-083): resized blob + upload state, keyed by `clientMutationId`. */
export const OFFLINE_PHOTOS_STORE = "photos";
/** Rejected queued taps the driver has not acknowledged yet, keyed by `clientMutationId`. */
export const OFFLINE_NOTICES_STORE = "notices";

/** Cache Storage bucket holding the photos of the cached tour (and nothing else). */
export const PHOTO_CACHE_NAME = "nudel-driver-photos-v1";

/**
 * Stable same-origin URL under which a photo is kept in Cache Storage and shown while offline.
 * The key is the photo id (photos are immutable: a replaced photo gets a new id), NOT the signed
 * storage URL, which changes with every tour reload. Under `/api` so the proxy leaves it alone;
 * the service worker answers it from the photo cache, the network is never asked.
 */
export const PHOTO_CACHE_PATH = "/api/driver/photo-cache/";

export function photoCacheUrl(photoId: string): string {
  return `${PHOTO_CACHE_PATH}${encodeURIComponent(photoId)}`;
}

/** Public, prerendered page without personal data that the worker serves for driver pages offline. */
export const OFFLINE_SHELL_SEGMENT = "driver/offline-shell";

export const TOUR_API_PATH = "/api/driver/tour/today";

/** Batch sync endpoint (NUD-082). */
export const SYNC_API_PATH = "/api/driver/sync";

/** Registers an uploaded photo as the customer's current one (NUD-083). */
export const PHOTO_REGISTER_API_PATH = "/api/driver/photos";

/** Background Sync API tag: the service worker flushes the outbox when the browser says "online". */
export const OUTBOX_SYNC_TAG = "nudel-outbox";

/** Message the worker posts to open pages after it flushed the outbox. */
export const OUTBOX_FLUSHED_MESSAGE = "nudel-outbox-flushed";
