/// <reference lib="webworker" />
import { NetworkOnly, type PrecacheEntry, Serwist } from "serwist";

import { isDriverNavigation } from "./rules";

declare global {
  interface WorkerGlobalScope {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}
declare const self: ServiceWorkerGlobalScope;

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
      // Driver pages always come from the network (they are personal and authenticated).
      // Nothing is stored; when the network fails the fallback below answers.
      matcher: ({ request, url }) => isDriverNavigation(request, url),
      handler: new NetworkOnly(),
    },
  ],
  // Precached, generic page without personal data (see scripts/lib/offline-page.ts).
  fallbacks: {
    entries: [
      {
        url: "/offline.html",
        matcher: ({ request }) => request.destination === "document",
      },
    ],
  },
});

serwist.addEventListeners();
