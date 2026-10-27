import type { LatLng } from "@/domain/routing";

export type { LatLng };

/** GeoJSON LineString; `coordinates` are `[lng, lat]` pairs (what `TourMap` expects). */
export type RouteLineString = { type: "LineString"; coordinates: [number, number][] };

export type RouteLeg = { distanceM: number; durationS: number };

export type RouteResult = {
  /** One leg per hop: depot -> stop 1, ..., stop n -> depot (n + 1 legs; empty for no stops). */
  legs: RouteLeg[];
  geometry: RouteLineString;
  totalDistanceM: number;
  /** Driving time only; service time at the stops is added by the tour builder (NUD-041). */
  totalDurationS: number;
  /** `true` when computed by the local heuristic (estimated distances, straight-line geometry). */
  approximate: boolean;
};

export type OptimizeResult = RouteResult & { orderedStopIds: string[] };

export type OptimizeInput = {
  depot: LatLng;
  stops: { id: string; location: LatLng; serviceSeconds: number }[];
};

export type RouteInput = { depot: LatLng; orderedStops: LatLng[] };

/** NUD-147: several vehicles with a capacity in kg; every stop is a job with a weight in kg. */
export type DistributeInput = {
  depot: LatLng;
  vehicles: { id: string; capacityKg: number }[];
  stops: { id: string; location: LatLng; serviceSeconds: number; weightKg: number }[];
};

export type DistributeResult = {
  /** One route per vehicle that is used, in visiting order; vehicles without stops are left out. */
  routes: { vehicleId: string; stopIds: string[] }[];
  /** Stops that fit into no vehicle's first trip: they become reload trips (`packReloadTrips`). */
  unassigned: string[];
  /** `true` when computed by the local heuristic. */
  approximate: boolean;
};

/**
 * Computes visiting orders and road routes. Implementations: OpenRouteService
 * (`OrsRoutingProvider`), the local `LocalHeuristicProvider`, and `FallbackRoutingProvider`
 * which tries the first and falls back to the second.
 */
export interface RoutingProvider {
  /** Best visiting order for one vehicle that starts and ends at the depot. */
  optimize(input: OptimizeInput): Promise<OptimizeResult>;
  /** Route through the stops in the given order (for manual reordering). */
  route(input: RouteInput): Promise<RouteResult>;
  /**
   * Splits the stops across several vehicles without exceeding any capacity and orders each
   * vehicle's stops (NUD-147, D24). Stops that fit nowhere come back as `unassigned`.
   */
  distribute(input: DistributeInput): Promise<DistributeResult>;
}

/** Most stops one tour may have (ORS free-tier limits). Larger inputs raise `TOO_MANY_STOPS`. */
export const MAX_STOPS = 50;
/** Whole-call deadline of the ORS provider before the fallback takes over. */
export const ROUTING_TIMEOUT_MS = 8000;

export type RoutingErrorCode =
  "TIMEOUT" | "NETWORK" | "HTTP" | "BAD_RESPONSE" | "INVALID_INPUT" | "TOO_MANY_STOPS" | "NO_ROUTE";

export class RoutingError extends Error {
  constructor(
    message: string,
    readonly code: RoutingErrorCode,
    readonly status?: number,
  ) {
    super(message);
    this.name = "RoutingError";
  }
}

function validPoint(p: LatLng): boolean {
  return (
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lng) <= 180
  );
}

/** Shared input checks. Throws `RoutingError` (`INVALID_INPUT` or `TOO_MANY_STOPS`). */
export function assertValidPoints(depot: LatLng, stops: readonly LatLng[]): void {
  if (!validPoint(depot) || !stops.every(validPoint)) {
    throw new RoutingError("Invalid coordinates", "INVALID_INPUT");
  }
  if (stops.length > MAX_STOPS) {
    throw new RoutingError(
      `A tour can have at most ${MAX_STOPS} stops (got ${stops.length}); split the deliveries`,
      "TOO_MANY_STOPS",
    );
  }
}

export function assertValidDistributeInput(input: DistributeInput): void {
  assertValidOptimizeInput({ depot: input.depot, stops: input.stops });
  const ids = new Set(input.vehicles.map((v) => v.id));
  if (
    input.vehicles.length === 0 ||
    ids.size !== input.vehicles.length ||
    input.vehicles.some((v) => !v.id || !Number.isFinite(v.capacityKg) || v.capacityKg <= 0)
  ) {
    throw new RoutingError("Vehicles need unique ids and a capacity > 0", "INVALID_INPUT");
  }
  if (input.stops.some((s) => !Number.isFinite(s.weightKg) || s.weightKg < 0)) {
    throw new RoutingError("weightKg must be >= 0", "INVALID_INPUT");
  }
}

export function assertValidOptimizeInput(input: OptimizeInput): void {
  assertValidPoints(
    input.depot,
    input.stops.map((s) => s.location),
  );
  const ids = new Set(input.stops.map((s) => s.id));
  if (ids.size !== input.stops.length || input.stops.some((s) => !s.id)) {
    throw new RoutingError("Stop ids must be non-empty and unique", "INVALID_INPUT");
  }
  if (input.stops.some((s) => !Number.isFinite(s.serviceSeconds) || s.serviceSeconds < 0)) {
    throw new RoutingError("serviceSeconds must be >= 0", "INVALID_INPUT");
  }
}

/** Result for a tour without stops. */
export function emptyRoute(depot: LatLng, approximate: boolean): RouteResult {
  return {
    legs: [],
    geometry: {
      type: "LineString",
      coordinates: [
        [depot.lng, depot.lat],
        [depot.lng, depot.lat],
      ],
    },
    totalDistanceM: 0,
    totalDurationS: 0,
    approximate,
  };
}
