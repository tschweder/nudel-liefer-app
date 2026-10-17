import { estimateLegs, heuristicOrder } from "@/domain/routing";

import {
  assertValidOptimizeInput,
  assertValidPoints,
  emptyRoute,
  type LatLng,
  type OptimizeInput,
  type OptimizeResult,
  type RouteInput,
  type RouteResult,
  type RoutingProvider,
} from "./types";

function build(depot: LatLng, ordered: LatLng[]): RouteResult {
  if (ordered.length === 0) return emptyRoute(depot, true);
  const legs = estimateLegs(depot, ordered);
  return {
    legs,
    // Straight lines between the points: there is no road geometry without a routing service.
    geometry: {
      type: "LineString",
      coordinates: [depot, ...ordered, depot].map((p): [number, number] => [p.lng, p.lat]),
    },
    totalDistanceM: legs.reduce((sum, l) => sum + l.distanceM, 0),
    totalDurationS: legs.reduce((sum, l) => sum + l.durationS, 0),
    approximate: true,
  };
}

/**
 * Offline routing: haversine distance x 1.3, 30 km/h, nearest-neighbour + 2-opt. Every result is
 * flagged `approximate: true` (estimates, not road data).
 */
export class LocalHeuristicProvider implements RoutingProvider {
  async optimize(input: OptimizeInput): Promise<OptimizeResult> {
    assertValidOptimizeInput(input);
    const order = heuristicOrder(
      input.depot,
      input.stops.map((s) => s.location),
    );
    const ordered = order.map((i) => input.stops[i]!);
    return {
      orderedStopIds: ordered.map((s) => s.id),
      ...build(
        input.depot,
        ordered.map((s) => s.location),
      ),
    };
  }

  async route(input: RouteInput): Promise<RouteResult> {
    assertValidPoints(input.depot, input.orderedStops);
    return build(input.depot, input.orderedStops);
  }
}
