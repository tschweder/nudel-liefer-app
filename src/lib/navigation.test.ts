import { describe, expect, it } from "vitest";

import { appleMapsNavigationUrl, googleMapsNavigationUrl } from "./navigation";

describe("googleMapsNavigationUrl", () => {
  it("uses the pinned coordinates", () => {
    expect(googleMapsNavigationUrl(48.2082, 16.3738)).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=48.2082,16.3738&travelmode=driving",
    );
  });
  it("keeps negative coordinates", () => {
    expect(googleMapsNavigationUrl(-33.86, -70.5)).toContain("destination=-33.86,-70.5&");
  });
});

describe("appleMapsNavigationUrl", () => {
  it("uses the pinned coordinates, never an address", () => {
    expect(appleMapsNavigationUrl(48.2082, 16.3738)).toBe(
      "https://maps.apple.com/?daddr=48.2082,16.3738",
    );
  });
});
