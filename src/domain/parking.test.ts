import { describe, expect, it } from "vitest";

import { activeParkingSpots, defaultParkingSpot, moveItem } from "./parking";

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
