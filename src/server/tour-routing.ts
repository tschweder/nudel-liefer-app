import {
  computeTripSchedule,
  groupByTrip,
  normalizeTrips,
  type TripSchedule,
} from "@/domain/fleet";

import type { LatLng, RouteLeg, RouteLineString, RoutingProvider } from "./routing";

/** Legs of a tour with reload trips (NUD-147). With one trip it is exactly `RoutingProvider.route()`. */
export type RoutedTrips = {
  /** Leg arriving at each stop, in tour order (from the depot for the first stop of a trip). */
  stopLegs: RouteLeg[];
  /** Leg back to the depot at the end of each trip (one per trip, none for an empty tour). */
  returnLegs: RouteLeg[];
  geometry: RouteLineString;
  /** Driving distance of the whole tour including the ways back to the depot, whole metres. */
  totalDistanceM: number;
  approximate: boolean;
};

const round = (leg: RouteLeg): RouteLeg => ({
  distanceM: Math.round(leg.distanceM),
  durationS: Math.round(leg.durationS),
});

/**
 * Routes a tour whose stops are split into trips (`trips[i]` = trip of stop i, normalized): one
 * `route()` call per trip (depot -> its stops -> depot), results joined. A provider answering with
 * a wrong number of legs is a bug, not a user error (throws a plain `Error`, like the callers did).
 */
export async function routeTrips(
  provider: RoutingProvider,
  depot: LatLng,
  points: readonly LatLng[],
  trips: readonly number[] = [],
): Promise<RoutedTrips> {
  const normalized = normalizeTrips(points.map((_, i) => trips[i] ?? 1));
  const groups = points.length === 0 ? [[]] : groupByTrip([...points], normalized);
  const stopLegs: RouteLeg[] = [];
  const returnLegs: RouteLeg[] = [];
  const coordinates: [number, number][] = [];
  let approximate = false;
  let geometry: RouteLineString | null = null;
  for (const group of groups) {
    const route = await provider.route({ depot, orderedStops: group });
    const expected = group.length === 0 ? 0 : group.length + 1;
    if (route.legs.length !== expected) {
      throw new Error(`Routing provider returned ${route.legs.length} legs, expected ${expected}`);
    }
    approximate = approximate || route.approximate;
    geometry = geometry ?? route.geometry;
    if (group.length > 0) {
      stopLegs.push(...route.legs.slice(0, group.length).map(round));
      returnLegs.push(round(route.legs[group.length]!));
    }
    // Trips share the depot point, so the geometry joins without a gap.
    coordinates.push(
      ...(coordinates.length === 0
        ? route.geometry.coordinates
        : route.geometry.coordinates.slice(1)),
    );
  }
  return {
    stopLegs,
    returnLegs,
    geometry: groups.length === 1 && geometry ? geometry : { type: "LineString", coordinates },
    totalDistanceM: [...stopLegs, ...returnLegs].reduce((sum, l) => sum + l.distanceM, 0),
    approximate,
  };
}

/** ETAs, reload times and total duration of a routed tour (`computeTripSchedule` over its trips). */
export function scheduleTrips(
  routed: Pick<RoutedTrips, "stopLegs" | "returnLegs">,
  trips: readonly number[],
  options: { departure: Date; serviceSecondsPerStop: number },
): TripSchedule {
  const normalized = normalizeTrips(routed.stopLegs.map((_, i) => trips[i] ?? 1));
  const legGroups = groupByTrip(
    routed.stopLegs.map((l) => l.durationS),
    normalized,
  );
  return computeTripSchedule({
    departure: options.departure,
    serviceSecondsPerStop: options.serviceSecondsPerStop,
    trips: legGroups.map((legs, index) => ({
      stopLegDurationsS: legs,
      returnLegDurationS: routed.returnLegs[index]?.durationS ?? 0,
    })),
  });
}
