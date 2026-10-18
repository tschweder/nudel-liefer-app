import { describe, expect, it } from "vitest";

import {
  DEV_TILE_ATTRIBUTION,
  DEV_TILE_URL,
  getMapTileConfig,
  isTileCacheEnabled,
} from "./map-config";

describe("getMapTileConfig", () => {
  it("defaults to OSM for development", () => {
    expect(getMapTileConfig({})).toEqual({ url: DEV_TILE_URL, attribution: DEV_TILE_ATTRIBUTION });
    expect(getMapTileConfig({ MAP_TILE_URL: "  " }).url).toBe(DEV_TILE_URL);
  });

  it("uses the configured provider and its attribution", () => {
    expect(
      getMapTileConfig({
        MAP_TILE_URL: " https://t.example/{z}/{x}/{y}.png ",
        MAP_TILE_ATTRIBUTION: "© Example",
      }),
    ).toEqual({ url: "https://t.example/{z}/{x}/{y}.png", attribution: "© Example" });
  });

  it("does not attribute OSM to a custom provider", () => {
    expect(
      getMapTileConfig({ MAP_TILE_URL: "https://t.example/{z}/{x}/{y}.png" }).attribution,
    ).toBe("");
  });
});

describe("tile cache flag (NUD-108)", () => {
  const URL = "https://t.example/{z}/{x}/{y}.png";

  it("is off by default", () => {
    expect(isTileCacheEnabled({})).toBe(false);
    expect(getMapTileConfig({ MAP_TILE_URL: URL }).cache).toBeUndefined();
  });

  it("needs MAP_TILE_CACHE=1 and an explicit tile URL", () => {
    expect(isTileCacheEnabled({ MAP_TILE_CACHE: "1", MAP_TILE_URL: URL })).toBe(true);
    expect(getMapTileConfig({ MAP_TILE_CACHE: "1", MAP_TILE_URL: URL }).cache).toBe(true);
    expect(isTileCacheEnabled({ MAP_TILE_CACHE: "true", MAP_TILE_URL: URL })).toBe(false);
    // the dev-only OSM default is never cached
    expect(isTileCacheEnabled({ MAP_TILE_CACHE: "1" })).toBe(false);
    expect(getMapTileConfig({ MAP_TILE_CACHE: "1" }).cache).toBeUndefined();
  });
});
