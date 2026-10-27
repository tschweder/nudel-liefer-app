import { describe, expect, it } from "vitest";

import {
  appleMapsNavigationUrl,
  googleMapsNavigationUrl,
  stopAppleNavigationUrl,
  stopGoogleNavigationUrl,
} from "./navigation";

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

describe("stop navigation (D30)", () => {
  const park = { lat: 48.5, lng: 16.9 };
  it("guides to the Parkplatz first and the address second", () => {
    expect(
      stopGoogleNavigationUrl({
        lat: 48.5,
        lng: 16.9,
        addressLat: 48.21,
        addressLng: 16.3,
        parkingSpots: [park, { lat: 1, lng: 2 }],
      }),
    ).toBe(
      "https://www.google.com/maps/dir/?api=1&waypoints=48.5,16.9&destination=48.21,16.3&travelmode=driving",
    );
  });
  it("goes to the address point without a Parkplatz", () => {
    expect(
      stopGoogleNavigationUrl({ lat: 48.21, lng: 16.3, addressLat: 48.21, addressLng: 16.3 }),
    ).toBe(googleMapsNavigationUrl(48.21, 16.3));
  });
  it("goes to the Parkplatz alone when the address point is unknown", () => {
    expect(stopGoogleNavigationUrl({ lat: 48.5, lng: 16.9, parkingSpots: [park] })).toBe(
      googleMapsNavigationUrl(48.5, 16.9),
    );
  });
  it("has no link without any location", () => {
    expect(stopGoogleNavigationUrl({ lat: null, lng: null })).toBeNull();
    expect(stopAppleNavigationUrl({ lat: null, lng: null })).toBeNull();
  });
  it("sends Apple Maps to the routing point (the Parkplatz) only", () => {
    expect(
      stopAppleNavigationUrl({
        lat: 48.5,
        lng: 16.9,
        addressLat: 48.21,
        addressLng: 16.3,
        parkingSpots: [park],
      }),
    ).toBe("https://maps.apple.com/?daddr=48.5,16.9");
  });
});
