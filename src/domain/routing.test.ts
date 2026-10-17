import { describe, expect, it } from "vitest";

import {
  distanceMatrix,
  estimatedDurationS,
  estimateLegs,
  haversineM,
  heuristicOrder,
  nearestNeighbourOrder,
  tourLength,
  twoOpt,
} from "./routing";

/** Euclidean matrix for abstract test points; index 0 is the depot. */
const euclid = (pts: [number, number][]) =>
  pts.map((a) => pts.map((b) => Math.hypot(a[0] - b[0], a[1] - b[1])));

describe("haversineM", () => {
  it("is 0 for identical points and symmetric", () => {
    const a = { lat: 48.2082, lng: 16.3738 };
    const b = { lat: 47.0707, lng: 15.4395 };
    expect(haversineM(a, a)).toBe(0);
    expect(haversineM(a, b)).toBeCloseTo(haversineM(b, a), 6);
  });

  it("matches the known Vienna - Graz distance (about 145 km)", () => {
    const d = haversineM({ lat: 48.2082, lng: 16.3738 }, { lat: 47.0707, lng: 15.4395 });
    expect(d / 1000).toBeGreaterThan(140);
    expect(d / 1000).toBeLessThan(150);
  });
});

describe("estimates", () => {
  it("applies the road factor 1.3 and 30 km/h", () => {
    const a = { lat: 48, lng: 16 };
    const b = { lat: 48.1, lng: 16 };
    const [leg] = estimateLegs(a, [b]);
    expect(leg!.distanceM).toBe(Math.round(haversineM(a, b) * 1.3));
    expect(estimatedDurationS(30_000)).toBeCloseTo(3600, 6);
  });

  it("returns n + 1 legs including the way back", () => {
    const depot = { lat: 48, lng: 16 };
    expect(
      estimateLegs(depot, [
        { lat: 48.1, lng: 16 },
        { lat: 48.1, lng: 16.1 },
      ]),
    ).toHaveLength(3);
  });
});

describe("nearestNeighbourOrder", () => {
  it("always goes to the closest unvisited node", () => {
    // depot at 0 on a line; nodes at 1, 5, 2, 9
    const dist = euclid([
      [0, 0],
      [1, 0],
      [5, 0],
      [2, 0],
      [9, 0],
    ]);
    expect(nearestNeighbourOrder(dist)).toEqual([1, 3, 2, 4]);
  });

  it("breaks ties by lowest index and handles no stops", () => {
    const dist = euclid([
      [0, 0],
      [1, 0],
      [-1, 0],
    ]);
    expect(nearestNeighbourOrder(dist)).toEqual([1, 2]);
    expect(nearestNeighbourOrder([[0]])).toEqual([]);
  });
});

describe("twoOpt", () => {
  // Depot bottom-left corner of a unit square; 1 = bottom-right, 2 = top-right, 3 = top-left.
  const dist = euclid([
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ]);

  it("removes a crossing", () => {
    const crossing = [2, 1, 3]; // 0 -> (1,1) -> (1,0) -> (0,1) -> 0 crosses itself
    const improved = twoOpt(dist, crossing);
    expect(tourLength(dist, crossing)).toBeCloseTo(2 + 2 * Math.SQRT2, 6);
    expect(tourLength(dist, improved)).toBeCloseTo(4, 6);
    expect(tourLength(dist, improved)).toBeLessThan(tourLength(dist, crossing));
  });

  it("keeps every node exactly once and leaves an optimal tour alone", () => {
    expect([...twoOpt(dist, [2, 1, 3])].sort()).toEqual([1, 2, 3]);
    expect(twoOpt(dist, [1, 2, 3])).toEqual([1, 2, 3]);
  });

  it("handles 0, 1 and 2 stops", () => {
    expect(twoOpt([[0]], [])).toEqual([]);
    expect(
      twoOpt(
        euclid([
          [0, 0],
          [1, 0],
        ]),
        [1],
      ),
    ).toEqual([1]);
    expect(
      twoOpt(
        euclid([
          [0, 0],
          [1, 0],
          [2, 0],
        ]),
        [2, 1],
      ),
    ).toHaveLength(2);
  });

  it("never makes a random tour longer", () => {
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const pts: [number, number][] = Array.from({ length: 25 }, () => [rand(), rand()]);
    const d = euclid(pts);
    const order = Array.from({ length: 24 }, (_, i) => i + 1);
    expect(tourLength(d, twoOpt(d, order))).toBeLessThanOrEqual(tourLength(d, order));
  });
});

describe("heuristicOrder", () => {
  it("returns indices into the stops, best first, and is not worse than nearest-neighbour", () => {
    const depot = { lat: 48.2082, lng: 16.3738 };
    const stops = [
      { lat: 48.23, lng: 16.42 },
      { lat: 48.2, lng: 16.35 },
      { lat: 48.19, lng: 16.39 },
      { lat: 48.25, lng: 16.3 },
    ];
    const order = heuristicOrder(depot, stops);
    expect([...order].sort()).toEqual([0, 1, 2, 3]);
    const d = distanceMatrix([depot, ...stops]);
    expect(
      tourLength(
        d,
        order.map((i) => i + 1),
      ),
    ).toBeLessThanOrEqual(tourLength(d, nearestNeighbourOrder(d)));
    expect(heuristicOrder(depot, [])).toEqual([]);
  });
});
