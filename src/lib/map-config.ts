export type MapTileConfig = { url: string; attribution: string };

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
  return { url, attribution: env.MAP_TILE_ATTRIBUTION?.trim() ?? "" };
}
