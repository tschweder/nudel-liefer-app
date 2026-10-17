import { describe, expect, it } from "vitest";

import { DEV_TILE_ATTRIBUTION, DEV_TILE_URL, getMapTileConfig } from "./map-config";

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
