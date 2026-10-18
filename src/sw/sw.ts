/// <reference lib="webworker" />
import { CacheOnly, NetworkOnly, type PrecacheEntry, Serwist } from "serwist";

import { PHOTO_CACHE_NAME } from "../lib/offline/constants";
import { isDriverNavigation, isPhotoCachePath, offlineShellUrl, offlineShellUrls } from "./rules";

declare global {
  interface WorkerGlobalScope {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}
declare const self: ServiceWorkerGlobalScope;

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
        url: "/offline.html",
        matcher: ({ request }) => request.destination === "document",
      },
    ],
  },
});

serwist.addEventListeners();
