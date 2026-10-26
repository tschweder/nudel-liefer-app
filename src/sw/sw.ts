/// <reference lib="webworker" />
import { CacheOnly, NetworkOnly, type PrecacheEntry, Serwist } from "serwist";

import { withBasePath } from "../lib/base-path";
import {
  OUTBOX_FLUSHED_MESSAGE,
  OUTBOX_SYNC_TAG,
  PHOTO_CACHE_NAME,
} from "../lib/offline/constants";
import { flushOutbox } from "../lib/offline/outbox-flush";
import { createIndexedDbOutboxStore } from "../lib/offline/outbox-store";
import { flushPhotos } from "../lib/offline/photo-outbox-flush";
import { createIndexedDbPhotoStore } from "../lib/offline/photo-outbox-store";
import { createBrowserPhotoCache } from "../lib/offline/photos";
import {
  isDriverNavigation,
  isPhotoCachePath,
  isTileRequest,
  offlineShellUrl,
  offlineShellUrls,
  tileUrlPattern,
} from "./rules";
import { handleTileRequest, TILE_CACHE_NAME } from "./tile-cache";

declare global {
  interface WorkerGlobalScope {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}
declare const self: ServiceWorkerGlobalScope;
/** `MAP_TILE_URL` when built with `MAP_TILE_CACHE=1` (scripts/build-pwa.ts), else "" (NUD-108). */
declare const __TILE_CACHE_URL__: string;

const tilePattern = __TILE_CACHE_URL__ ? tileUrlPattern(__TILE_CACHE_URL__) : null;

// How long a driver page load may take before the offline shell is shown instead. Streaming pages
// answer with headers quickly; a hanging connection must not leave the driver on a white screen.
const NAVIGATION_TIMEOUT_SECONDS = 8;

// Placeholder (no runtime change) replaced with the precache list by scripts/build-pwa.ts.
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  // `?dpl=` is the deployment id some hosts append to asset URLs.
  precacheOptions: { cleanupOutdatedCaches: true, ignoreURLParametersMatching: [/^dpl$/] },
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: false,
  runtimeCaching: [
    // Opt-in (NUD-108): tiles the driver looked at, LRU 300 / 7 days. Absent when not enabled.
    ...(tilePattern
      ? [
          {
            matcher: ({ request }: { request: Request }) =>
              request.destination === "image" && isTileRequest(request.url, tilePattern),
            handler: async ({ request }: { request: Request }) =>
              handleTileRequest(request, await caches.open(TILE_CACHE_NAME), (r) => fetch(r)),
          },
        ]
      : []),
    {
      // Photos of the cached tour (NUD-081): the page stores them under this stable URL, the
      // worker only reads them. A miss is an error, the network is never asked.
      matcher: ({ url }) => isPhotoCachePath(url.pathname),
      handler: new CacheOnly({ cacheName: PHOTO_CACHE_NAME }),
    },
    {
      // Driver pages always come from the network (they are personal and authenticated).
      // Nothing is stored; when the network fails the fallbacks below answer.
      matcher: ({ request, url }) => isDriverNavigation(request, url),
      handler: new NetworkOnly({ networkTimeoutSeconds: NAVIGATION_TIMEOUT_SECONDS }),
    },
  ],
  fallbacks: {
    entries: [
      // The tour list and stop details are rendered by the precached offline shell from the data
      // the page keeps in IndexedDB (no personal data in the shell itself).
      ...offlineShellUrls().map((url) => ({
        url,
        matcher: ({ request }: { request: Request }) =>
          request.destination === "document" &&
          offlineShellUrl(new URL(request.url).pathname) === url,
      })),
      // Everything else (login, language picker, ...): precached generic page.
      {
        url: withBasePath("/offline.html"),
        matcher: ({ request }) => request.destination === "document",
      },
    ],
  },
});

serwist.addEventListeners();

/**
 * Background Sync (NUD-082, progressive enhancement; Chromium only): when the browser regains a
 * connection it fires `sync` for the tag the page registered after queueing a tap, also when the
 * app is closed. The worker sends the queue of the driver the phone holds a tour copy for (the
 * single user id in the `tours` store; none or several -> leave it to the page, which knows the
 * logged-in user), then tells open pages to refresh. A network or server failure rejects the
 * promise, so the browser schedules another attempt.
 */
async function flushOutboxInBackground(): Promise<void> {
  const store = createIndexedDbOutboxStore();
  const userIds = await store.tourUserIds();
  if (userIds.length !== 1) return;
  const userId = userIds[0]!;
  const outcome = await flushOutbox(userId, {
    store,
    fetchImpl: (input, init) => fetch(input, init),
    now: () => new Date(),
  });
  // Photos the driver took (NUD-083) go out after the taps: upload, register, cache the blob.
  const photoCache = createBrowserPhotoCache();
  const photos = await flushPhotos(userId, {
    store: createIndexedDbPhotoStore(),
    putNotice: (notice) => store.putNotice(notice),
    cachePhoto: (photoId, blob) =>
      photoCache.put(
        photoId,
        new Response(blob, { headers: { "Content-Type": blob.type || "image/jpeg" } }),
      ),
    fetchImpl: (input, init) => fetch(input, init),
    now: () => new Date(),
  });
  const changed =
    (outcome.kind === "ran" && outcome.applied + outcome.rejected > 0) ||
    (photos.kind === "ran" && photos.registered.length + photos.rejected > 0);
  if (changed) {
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of clients) client.postMessage({ type: OUTBOX_FLUSHED_MESSAGE });
  }
  const failures = [
    outcome.kind === "ran" ? outcome.failure : null,
    photos.kind === "ran" ? photos.failure : null,
  ];
  if (failures.some((f) => f === "network" || f === "server")) {
    throw new Error("outbox flush failed");
  }
}

self.addEventListener("sync", (event) => {
  const syncEvent = event as Event & { tag?: string; waitUntil(promise: Promise<unknown>): void };
  if (syncEvent.tag === OUTBOX_SYNC_TAG) syncEvent.waitUntil(flushOutboxInBackground());
});
