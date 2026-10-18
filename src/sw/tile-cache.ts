/**
 * Opt-in runtime cache for map tiles (NUD-108, `MAP_TILE_CACHE=1`, default OFF).
 *
 * Browser-cache-like by design: only tiles the page actually requested are stored (no prefetch, no
 * bounding-box download, which tile providers generally forbid), at most `TILE_CACHE_MAX_ENTRIES`
 * (least recently used goes first) and no longer than `TILE_CACHE_MAX_AGE_MS`. Only complete CORS
 * answers are stored (never opaque ones). Free of worker globals so it is unit-tested.
 */
export const TILE_CACHE_NAME = "nudel-map-tiles-v1";
export const TILE_CACHE_MAX_ENTRIES = 300;
export const TILE_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const STORED_AT_HEADER = "x-nudel-stored-at";

type TileCache = Pick<Cache, "match" | "put" | "delete" | "keys">;

async function store(cache: TileCache, request: Request, response: Response, now: number) {
  const headers = new Headers(response.headers);
  headers.set(STORED_AT_HEADER, String(now));
  const copy = new Response(await response.clone().blob(), { status: 200, headers });
  await cache.delete(request);
  await cache.put(request, copy);
}

async function trim(cache: TileCache, max: number) {
  const keys = await cache.keys();
  // keys() lists the entries in insertion order; every hit and every store re-inserts, so the
  // first ones are the least recently used.
  for (const key of keys.slice(0, Math.max(0, keys.length - max))) await cache.delete(key);
}

export async function handleTileRequest(
  request: Request,
  cache: TileCache,
  fetchImpl: (request: Request) => Promise<Response>,
  now: () => number = Date.now,
  max: number = TILE_CACHE_MAX_ENTRIES,
): Promise<Response> {
  const hit = await cache.match(request);
  const storedAt = Number(hit?.headers.get(STORED_AT_HEADER) ?? NaN);
  const fresh = hit !== undefined && now() - storedAt < TILE_CACHE_MAX_AGE_MS;
  if (hit && fresh) {
    // "Recently used": move it to the end of the insertion order.
    await store(cache, request, hit, storedAt);
    return hit;
  }
  try {
    const response = await fetchImpl(request);
    if (response.status === 200 && response.type !== "opaque") {
      await store(cache, request, response, now());
      await trim(cache, max);
    }
    return response;
  } catch (error) {
    if (hit) return hit; // expired but better than nothing in a dead spot
    throw error;
  }
}
