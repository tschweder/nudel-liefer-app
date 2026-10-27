import { describe, expect, it } from "vitest";

import {
  computeTripSchedule,
  groupByTrip,
  normalizeTrips,
  orderTrip,
  packReloadTrips,
  RELOAD_SECONDS,
  splitByCapacity,
  sweepOrder,
  tripLoadsKg,
} from "./fleet";
import { computeSchedule } from "./tour";

const depot = { lat: 48.2, lng: 16.37 };
const stop = (id: string, dLat: number, dLng: number, weightKg: number) => ({
  id,
  location: { lat: depot.lat + dLat, lng: depot.lng + dLng },
  weightKg,
});

// Eight stops of 100 kg around the depot = 800 kg.
const ring = [
  stop("n", 0.05, 0, 100),
  stop("ne", 0.04, 0.04, 100),
  stop("e", 0, 0.05, 100),
  stop("se", -0.04, 0.04, 100),
  stop("s", -0.05, 0, 100),
  stop("sw", -0.04, -0.04, 100),
  stop("w", 0, -0.05, 100),
  stop("nw", 0.04, -0.04, 100),
];
const weightOf = (ids: string[]) =>
  ids.reduce((sum, id) => sum + ring.find((s) => s.id === id)!.weightKg, 0);

describe("splitByCapacity", () => {
  it("2 vehicles x 500 kg, 800 kg of stops -> two routes, none over capacity, nothing left", () => {
    const split = splitByCapacity(depot, ring, [
      { id: "v1", capacityKg: 500 },
      { id: "v2", capacityKg: 500 },
    ]);
    expect(split.routes).toHaveLength(2);
    expect(split.unassigned).toEqual([]);
    for (const route of split.routes) expect(weightOf(route.stopIds)).toBeLessThanOrEqual(500);
    expect(split.routes.flatMap((r) => r.stopIds).sort()).toEqual(ring.map((s) => s.id).sort());
  });

  it("1 vehicle x 500 kg, 800 kg of stops -> 300 kg are left over", () => {
    const split = splitByCapacity(depot, ring, [{ id: "v1", capacityKg: 500 }]);
    expect(split.routes).toHaveLength(1);
    expect(weightOf(split.routes[0]!.stopIds)).toBe(500);
    expect(weightOf(split.unassigned)).toBe(300);
  });

  it("does not use a vehicle that is not needed and fills the larger one first", () => {
    const split = splitByCapacity(depot, ring.slice(0, 2), [
      { id: "small", capacityKg: 300 },
      { id: "big", capacityKg: 1000 },
    ]);
    expect(split.routes).toEqual([{ vehicleId: "big", stopIds: expect.any(Array) }]);
    expect(split.routes[0]!.stopIds).toHaveLength(2);
  });

  it("is deterministic", () => {
    const vehicles = [
      { id: "v1", capacityKg: 500 },
      { id: "v2", capacityKg: 500 },
    ];
    expect(splitByCapacity(depot, ring, vehicles)).toEqual(
      splitByCapacity(depot, [...ring].reverse(), vehicles),
    );
  });

  it("no stops -> no routes", () => {
    expect(splitByCapacity(depot, [], [{ id: "v", capacityKg: 10 }])).toEqual({
      routes: [],
      unassigned: [],
    });
  });
});

describe("packReloadTrips", () => {
  it("packs the leftover into reload trips, each within the capacity", () => {
    const leftovers = ring.slice(0, 5);
    const { trips, oversized } = packReloadTrips(
      depot,
      [{ id: "v1", capacityKg: 300 }],
      new Map([["v1", 1]]),
      leftovers,
    );
    expect(oversized).toEqual([]);
    expect(trips.map((t) => t.vehicleId)).toEqual(["v1", "v1"]);
    expect(trips.map((t) => weightOf(t.stopIds))).toEqual([300, 200]);
  });

  it("gives trips to the vehicle with the fewest trips", () => {
    const { trips } = packReloadTrips(
      depot,
      [
        { id: "v1", capacityKg: 200 },
        { id: "v2", capacityKg: 200 },
      ],
      new Map([
        ["v1", 1],
        ["v2", 1],
      ]),
      ring.slice(0, 4),
    );
    expect(trips.map((t) => t.vehicleId)).toEqual(["v1", "v2"]);
  });

  it("a stop heavier than the vehicle gets a trip of its own and is reported", () => {
    const heavy = { ...stop("heavy", 0.01, 0.01, 900), weightKg: 900 };
    const { trips, oversized } = packReloadTrips(
      depot,
      [{ id: "v1", capacityKg: 500 }],
      new Map(),
      [heavy, ring[0]!],
    );
    expect(oversized).toEqual(["heavy"]);
    expect(trips.map((t) => t.stopIds).sort()).toEqual([["heavy"], ["n"]]);
  });
});

describe("sweepOrder / orderTrip", () => {
  it("keeps neighbours together and covers every stop once", () => {
    const order = sweepOrder(depot, ring).map((s) => s.id);
    expect([...order].sort()).toEqual(ring.map((s) => s.id).sort());
    // consecutive stops in the sweep are neighbours on the ring
    const ringOrder = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];
    const idx = order.map((id) => ringOrder.indexOf(id));
    for (let i = 1; i < idx.length; i++) {
      expect(Math.min((idx[i]! - idx[i - 1]! + 8) % 8, (idx[i - 1]! - idx[i]! + 8) % 8)).toBe(1);
    }
  });

  it("orders a trip by nearest neighbour + 2-opt", () => {
    expect(orderTrip(depot, ring).sort()).toEqual(ring.map((s) => s.id).sort());
    expect(orderTrip(depot, [])).toEqual([]);
  });
});

describe("normalizeTrips / groupByTrip / tripLoadsKg", () => {
  it("makes trips non-decreasing and gap-free", () => {
    expect(normalizeTrips([1, 1, 2, 2, 3])).toEqual([1, 1, 2, 2, 3]);
    expect(normalizeTrips([2, 2, 4])).toEqual([1, 1, 2]);
    expect(normalizeTrips([1, 3, 2, 3])).toEqual([1, 2, 2, 2]);
    expect(normalizeTrips([])).toEqual([]);
    expect(normalizeTrips([0, 1])).toEqual([1, 1]);
  });

  it("groups by trip in tour order", () => {
    expect(groupByTrip(["a", "b", "c"], [1, 1, 2])).toEqual([["a", "b"], ["c"]]);
    expect(groupByTrip(["a"], [1])).toEqual([["a"]]);
  });

  it("sums the load per trip", () => {
    expect(
      tripLoadsKg([
        { trip: 1, weightKg: 100.5 },
        { trip: 1, weightKg: 200 },
        { trip: 2, weightKg: 50 },
      ]),
    ).toEqual([300.5, 50]);
    expect(tripLoadsKg([])).toEqual([]);
  });
});

describe("computeTripSchedule", () => {
  const departure = new Date("2026-10-27T05:00:00Z");

  it("equals computeSchedule for one trip", () => {
    const legs = [600, 300, 450, 900];
    const single = computeTripSchedule({
      departure,
      trips: [{ stopLegDurationsS: legs.slice(0, 3), returnLegDurationS: 900 }],
      serviceSecondsPerStop: 120,
    });
    const reference = computeSchedule({
      departure,
      legDurationsS: legs,
      serviceSecondsPerStop: 120,
    });
    expect(single.etas).toEqual(reference.etas);
    expect(single.returnAt).toEqual(reference.returnAt);
    expect(single.totalDurationS).toBe(reference.totalDurationS);
    expect(single.reloadAt).toEqual([]);
  });

  it("adds the way back, the reload time and the next trip", () => {
    const schedule = computeTripSchedule({
      departure,
      trips: [
        { stopLegDurationsS: [600], returnLegDurationS: 500 },
        { stopLegDurationsS: [400], returnLegDurationS: 300 },
      ],
      serviceSecondsPerStop: 100,
    });
    // trip 1: 600 -> eta, +100 service, +500 back = 1200 at the depot; reload 1200 s; trip 2: +400
    expect(schedule.etas.map((e) => (e.getTime() - departure.getTime()) / 1000)).toEqual([
      600,
      1200 + RELOAD_SECONDS + 400,
    ]);
    expect((schedule.reloadAt[0]!.getTime() - departure.getTime()) / 1000).toBe(1200);
    expect(schedule.totalDurationS).toBe(1200 + RELOAD_SECONDS + 400 + 100 + 300);
  });

  it("no stops: nothing happens", () => {
    const schedule = computeTripSchedule({
      departure,
      trips: [],
      serviceSecondsPerStop: 100,
    });
    expect(schedule).toMatchObject({ etas: [], totalDurationS: 0 });
    expect(schedule.returnAt).toEqual(departure);
  });
});
