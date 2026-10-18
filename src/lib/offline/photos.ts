import { type PayloadPhoto } from "@/lib/driver-tour-model";

import { PHOTO_CACHE_NAME, photoCacheUrl } from "./constants";

/** The photos of the cached tour, keyed by photo id (see `photoCacheUrl`). */
export interface PhotoCache {
  ids(): Promise<string[]>;
  put(id: string, response: Response): Promise<void>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
}

export type PhotoSyncResult = { total: number; cached: number; failed: number };

const keyOf = (id: string) => new Request(new URL(photoCacheUrl(id), self.location.origin));

/** Cache Storage backed photo cache (browser only). */
export function createBrowserPhotoCache(): PhotoCache {
  const open = () => caches.open(PHOTO_CACHE_NAME);
  return {
    async ids() {
      const cache = await open();
      return (await cache.keys()).map((req) =>
        decodeURIComponent(new URL(req.url).pathname.split("/").pop() ?? ""),
      );
    },
    async put(id, response) {
      await (await open()).put(keyOf(id), response);
    },
    async delete(id) {
      await (await open()).delete(keyOf(id));
    },
    async clear() {
      await caches.delete(PHOTO_CACHE_NAME);
    },
  };
}

/**
 * Makes the cache hold exactly `photos`: photos already stored are kept (their id never changes
 * content), missing ones are downloaded from their signed URL (a few at a time), photos that are
 * not part of the tour any more are deleted. A failed download is counted, never faked.
 */
export async function syncPhotos(
  cache: PhotoCache,
  photos: PayloadPhoto[],
  fetchImpl: typeof fetch,
  concurrency = 4,
): Promise<PhotoSyncResult> {
  const wanted = new Set(photos.map((p) => p.id));
  const have = new Set(await cache.ids());
  for (const id of have) if (!wanted.has(id)) await cache.delete(id);

  const missing = photos.filter((p) => !have.has(p.id));
  let cached = photos.length - missing.length;
  let failed = 0;
  let next = 0;
  async function worker() {
    while (next < missing.length) {
      const photo = missing[next++]!;
      try {
        // Storage is another origin: the bucket's CORS rule must allow GET (docs/env.md). A
        // credentialed or opaque response would be neither safe nor measurable.
        const response = await fetchImpl(photo.url, {
          mode: "cors",
          credentials: "omit",
          cache: "no-store",
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const type = response.headers.get("content-type") ?? "";
        if (type && !type.startsWith("image/")) throw new Error(`unexpected type ${type}`);
        await cache.put(photo.id, response);
        cached += 1;
      } catch {
        failed += 1;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, missing.length) }, worker));
  return { total: photos.length, cached, failed };
}

/** Deletes the whole photo cache. */
export async function purgePhotoCache(cache: PhotoCache = createBrowserPhotoCache()) {
  await cache.clear();
}
