export type MapTileConfig = {
  url: string;
  attribution: string;
  /**
   * `MAP_TILE_CACHE=1` (NUD-108): the service worker keeps the tiles the user viewed. The tile
   * layer then requests them with CORS (`crossOrigin`), so the worker never stores opaque
   * responses, which count with a large padded size against the storage quota.
   */
  cache?: boolean;
};

/** OpenStreetMap standard tiles: fine for development only (OSM tile usage policy). */
export const DEV_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const DEV_TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Tile layer from `MAP_TILE_URL` / `MAP_TILE_ATTRIBUTION`; dev-only OSM defaults when unset. */
export function getMapTileConfig(
  env: Record<string, string | undefined> = process.env,
): MapTileConfig {
  const url = env.MAP_TILE_URL?.trim();
  if (!url) return { url: DEV_TILE_URL, attribution: DEV_TILE_ATTRIBUTION };
  return {
    url,
    attribution: env.MAP_TILE_ATTRIBUTION?.trim() ?? "",
    ...(isTileCacheEnabled(env) ? { cache: true } : {}),
  };
}

/**
 * Opt-in (default OFF, NUD-108): the worker caches tiles the user has looked at (never a bulk
 * download). Only with an explicit `MAP_TILE_URL`: the dev-only OSM default is never cached. Check
 * the provider's terms first (docs/env.md).
 */
export function isTileCacheEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.MAP_TILE_CACHE?.trim() === "1" && !!env.MAP_TILE_URL?.trim();
}
