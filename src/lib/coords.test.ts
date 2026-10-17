import { describe, expect, it } from "vitest";

import { isValidLatLng, roundCoord, roundLatLng } from "./coords";

describe("coords", () => {
  it("rounds to 6 decimals", () => {
    expect(roundCoord(48.20817449999)).toBe(48.208174);
    expect(roundCoord(16.3738189)).toBe(16.373819);
    expect(roundCoord(-0.0000004)).toBe(-0);
    expect(roundLatLng({ lat: 1.23456789, lng: -9.87654321 })).toEqual({
      lat: 1.234568,
      lng: -9.876543,
    });
  });

  it("validates ranges", () => {
    expect(isValidLatLng({ lat: 48.2, lng: 16.3 })).toBe(true);
    expect(isValidLatLng({ lat: 91, lng: 0 })).toBe(false);
    expect(isValidLatLng({ lat: 0, lng: -181 })).toBe(false);
    expect(isValidLatLng({ lat: Number.NaN, lng: 0 })).toBe(false);
  });
});
