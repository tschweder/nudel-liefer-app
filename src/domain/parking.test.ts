import { describe, expect, it } from "vitest";

import { activeParkingSpots, defaultParkingSpot, moveItem, routingPoint } from "./parking";

describe("parking spots", () => {
  const spots = [
    { id: "c", sortOrder: 2, active: true },
    { id: "x", sortOrder: 0, active: false },
    { id: "a", sortOrder: 1, active: true },
  ];

  it("lists active spots by sortOrder", () => {
    expect(activeParkingSpots(spots).map((s) => s.id)).toEqual(["a", "c"]);
  });

  it("the default is the first active spot, never an inactive one", () => {
    expect(defaultParkingSpot(spots)?.id).toBe("a");
    expect(defaultParkingSpot([{ sortOrder: 0, active: false }])).toBeNull();
    expect(defaultParkingSpot([])).toBeNull();
  });

  it("moves an item and ignores out-of-range moves", () => {
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveItem(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    expect(moveItem(["a", "b"], 0, 5)).toEqual(["a", "b"]);
  });
});

describe("routingPoint (D22, NUD-141)", () => {
  const spot = (lat: number, lng: number, sortOrder: number, active = true) => ({
    lat,
    lng,
    sortOrder,
    active,
  });

  it("is the default Parkplatz when the customer has one", () => {
    expect(
      routingPoint({
        lat: 48,
        lng: 16,
        parkingSpots: [spot(1, 1, 5), spot(2, 2, 1), spot(3, 3, 0, false)],
      }),
    ).toEqual({ lat: 2, lng: 2, source: "parking" });
  });

  it("falls back to the Lieferadresse without an active Parkplatz", () => {
    expect(routingPoint({ lat: 48, lng: 16, parkingSpots: [spot(3, 3, 0, false)] })).toEqual({
      lat: 48,
      lng: 16,
      source: "address",
    });
  });

  it("is null only when there is no location at all", () => {
    expect(routingPoint({ lat: null, lng: null, parkingSpots: [] })).toBeNull();
    expect(routingPoint({ lat: 48, lng: null, parkingSpots: [] })).toBeNull();
  });
});
