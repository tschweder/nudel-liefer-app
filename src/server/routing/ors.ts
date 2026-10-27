import { z } from "zod";

import {
  assertValidDistributeInput,
  assertValidOptimizeInput,
  assertValidPoints,
  type DistributeInput,
  type DistributeResult,
  emptyRoute,
  type LatLng,
  type OptimizeInput,
  type OptimizeResult,
  type RouteInput,
  type RouteLeg,
  type RouteLineString,
  type RouteResult,
  ROUTING_TIMEOUT_MS,
  RoutingError,
  type RoutingProvider,
  type StopTimeWindow,
} from "./types";

/**
 * VROOM time windows (NUD-148): jobs get `time_windows` in seconds since midnight, the vehicle a
 * working window that starts at the departure, so the arrival times VROOM computes are comparable.
 * Empty when no stop has a window.
 */
export function timeWindowFields(
  stops: readonly { timeWindow?: StopTimeWindow }[],
  departureS: number | undefined,
  enabled: boolean,
): {
  job: (index: number) => { time_windows?: [number, number][] };
  vehicle: { time_window?: [number, number] };
} {
  const active = enabled && stops.some((s) => s.timeWindow);
  const start = Math.max(0, Math.floor(departureS ?? 0));
  return {
    job: (index) => {
      const w = active ? stops[index]?.timeWindow : undefined;
      return w ? { time_windows: [[Math.floor(w.fromS), Math.ceil(w.toS)]] } : {};
    },
    vehicle: active ? { time_window: [start, start + 86_400] } : {},
  };
}

export const ORS_DEFAULT_BASE_URL = "https://api.openrouteservice.org";
export const ORS_PROFILES = ["driving-car", "driving-hgv"] as const;
export type OrsProfile = (typeof ORS_PROFILES)[number];
export const DEFAULT_PROFILE: OrsProfile = "driving-car";
/** ORS accepts at most 50 waypoints per directions request; longer tours are requested in chunks. */
export const MAX_DIRECTIONS_COORDINATES = 50;

const optimizationResponse = z.object({
  unassigned: z.array(z.unknown()).optional(),
  routes: z.array(
    z.object({
      steps: z.array(z.object({ type: z.string(), job: z.number().int().optional() })),
    }),
  ),
});

const fleetResponse = z.object({
  unassigned: z.array(z.object({ id: z.number().int() })).optional(),
  routes: z.array(
    z.object({
      vehicle: z.number().int(),
      steps: z.array(z.object({ type: z.string(), job: z.number().int().optional() })),
    }),
  ),
});

const directionsResponse = z.object({
  features: z
    .array(
      z.object({
        geometry: z.object({
          type: z.literal("LineString"),
          coordinates: z.array(z.tuple([z.number(), z.number()]).rest(z.number())).min(2),
        }),
        properties: z.object({
          segments: z.array(z.object({ distance: z.number().min(0), duration: z.number().min(0) })),
        }),
      }),
    )
    .min(1),
});

/**
 * Maps a VROOM (ORS `/optimization`) response to the visiting order as indices into the jobs
 * list. Job ids sent are `index + 1`. Throws `RoutingError` when the shape is wrong, a job is
 * unassigned, or the steps do not visit every job exactly once.
 */
export function mapOptimizationResponse(body: unknown, jobCount: number): number[] {
  const parsed = optimizationResponse.safeParse(body);
  if (!parsed.success || parsed.data.routes.length !== 1) {
    throw new RoutingError("Unexpected response from the optimization service", "BAD_RESPONSE");
  }
  if (parsed.data.unassigned?.length) {
    throw new RoutingError("The optimization service could not assign every stop", "NO_ROUTE");
  }
  const order: number[] = [];
  for (const step of parsed.data.routes[0]!.steps) {
    if (step.type !== "job") continue;
    if (step.job === undefined) {
      throw new RoutingError("Unexpected response from the optimization service", "BAD_RESPONSE");
    }
    order.push(step.job - 1);
  }
  const unique = new Set(order);
  if (
    order.length !== jobCount ||
    unique.size !== jobCount ||
    order.some((i) => !Number.isInteger(i) || i < 0 || i >= jobCount)
  ) {
    throw new RoutingError("The optimization service returned an incomplete order", "BAD_RESPONSE");
  }
  return order;
}

/**
 * Maps a multi-vehicle VROOM response (NUD-147) to indices: per used vehicle (index into the
 * vehicles list; ids sent are `index + 1`) the visiting order as job indices, plus the jobs left
 * `unassigned` (they do not fit any vehicle's capacity). Every job must appear exactly once.
 */
export function mapFleetResponse(
  body: unknown,
  jobCount: number,
  vehicleCount: number,
): { routes: { vehicle: number; jobs: number[] }[]; unassigned: number[] } {
  const parsed = fleetResponse.safeParse(body);
  if (!parsed.success) {
    throw new RoutingError("Unexpected response from the optimization service", "BAD_RESPONSE");
  }
  const seen = new Set<number>();
  const take = (index: number) => {
    if (!Number.isInteger(index) || index < 0 || index >= jobCount || seen.has(index)) {
      throw new RoutingError(
        "The optimization service returned an incomplete distribution",
        "BAD_RESPONSE",
      );
    }
    seen.add(index);
    return index;
  };
  const routes: { vehicle: number; jobs: number[] }[] = [];
  for (const route of parsed.data.routes) {
    const vehicle = route.vehicle - 1;
    if (vehicle < 0 || vehicle >= vehicleCount || routes.some((r) => r.vehicle === vehicle)) {
      throw new RoutingError("Unexpected response from the optimization service", "BAD_RESPONSE");
    }
    const jobs: number[] = [];
    for (const step of route.steps) {
      if (step.type !== "job") continue;
      if (step.job === undefined) {
        throw new RoutingError("Unexpected response from the optimization service", "BAD_RESPONSE");
      }
      jobs.push(take(step.job - 1));
    }
    if (jobs.length > 0) routes.push({ vehicle, jobs });
  }
  const unassigned = (parsed.data.unassigned ?? []).map((u) => take(u.id - 1));
  if (seen.size !== jobCount) {
    throw new RoutingError(
      "The optimization service returned an incomplete distribution",
      "BAD_RESPONSE",
    );
  }
  return { routes, unassigned };
}

/** Maps one ORS directions GeoJSON response to legs and geometry (2D coordinates). */
export function mapDirectionsResponse(
  body: unknown,
  coordinateCount: number,
): { legs: RouteLeg[]; coordinates: [number, number][] } {
  const parsed = directionsResponse.safeParse(body);
  const feature = parsed.success ? parsed.data.features[0]! : undefined;
  if (!feature || feature.properties.segments.length !== coordinateCount - 1) {
    throw new RoutingError("Unexpected response from the routing service", "BAD_RESPONSE");
  }
  return {
    legs: feature.properties.segments.map((s) => ({
      distanceM: Math.round(s.distance),
      durationS: Math.round(s.duration),
    })),
    coordinates: feature.geometry.coordinates.map((c): [number, number] => [c[0], c[1]]),
  };
}

export type OrsRoutingOptions = {
  apiKey: string;
  baseUrl?: string;
  /** `driving-car` (default) or `driving-hgv`. */
  profile?: OrsProfile;
  /** Deadline for one whole call (all requests together). Default 8 s. No retries: the caller falls back. */
  timeoutMs?: number;
  fetch?: typeof fetch;
};

/** OpenRouteService routing: `/optimization` (VROOM) for the order, `/v2/directions` for legs and geometry. */
export class OrsRoutingProvider implements RoutingProvider {
  private readonly baseUrl: string;
  private readonly profile: OrsProfile;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: OrsRoutingOptions) {
    this.baseUrl = (options.baseUrl ?? ORS_DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.profile = options.profile ?? DEFAULT_PROFILE;
    this.timeoutMs = options.timeoutMs ?? ROUTING_TIMEOUT_MS;
    this.fetchFn = options.fetch ?? fetch;
  }

  async optimize(input: OptimizeInput): Promise<OptimizeResult> {
    assertValidOptimizeInput(input);
    if (input.stops.length === 0) return { orderedStopIds: [], ...emptyRoute(input.depot, false) };
    const signal = AbortSignal.timeout(this.timeoutMs);
    const depot = lngLat(input.depot);
    const hasWindows = input.stops.some((s) => s.timeWindow);
    const solve = async (withWindows: boolean) => {
      const tw = timeWindowFields(input.stops, input.departureS, withWindows);
      const body = await this.post(
        "/optimization",
        {
          jobs: input.stops.map((s, i) => ({
            id: i + 1,
            location: lngLat(s.location),
            service: Math.round(s.serviceSeconds),
            ...tw.job(i),
          })),
          vehicles: [{ id: 1, profile: this.profile, start: depot, end: depot, ...tw.vehicle }],
        },
        signal,
      );
      return mapOptimizationResponse(body, input.stops.length);
    };
    // Windows that cannot all be met leave jobs unassigned: plan without them, the planner then
    // reports the stops whose ETA misses the window as warnings.
    const order = await solve(hasWindows).catch((error: unknown) => {
      if (hasWindows && error instanceof RoutingError && error.code === "NO_ROUTE") {
        return solve(false);
      }
      throw error;
    });
    const ordered = order.map((i) => input.stops[i]!);
    const route = await this.directions(
      input.depot,
      ordered.map((s) => s.location),
      signal,
    );
    return { orderedStopIds: ordered.map((s) => s.id), ...route };
  }

  /**
   * Multi-vehicle distribution (NUD-147): one `/optimization` call with a capacity per vehicle and
   * the weight of every stop as `delivery` (whole kg, rounded up). Jobs that fit no vehicle come
   * back as `unassigned`; the caller turns them into reload trips.
   */
  async distribute(input: DistributeInput): Promise<DistributeResult> {
    assertValidDistributeInput(input);
    if (input.stops.length === 0) return { routes: [], unassigned: [], approximate: false };
    const signal = AbortSignal.timeout(this.timeoutMs);
    const depot = lngLat(input.depot);
    const hasWindows = input.stops.some((s) => s.timeWindow);
    const solve = async (withWindows: boolean) => {
      const tw = timeWindowFields(input.stops, input.departureS, withWindows);
      const body = await this.post(
        "/optimization",
        {
          jobs: input.stops.map((s, i) => ({
            id: i + 1,
            location: lngLat(s.location),
            service: Math.round(s.serviceSeconds),
            delivery: [Math.ceil(s.weightKg)],
            ...tw.job(i),
          })),
          vehicles: input.vehicles.map((v, i) => ({
            id: i + 1,
            profile: this.profile,
            start: depot,
            end: depot,
            capacity: [Math.floor(v.capacityKg)],
            ...tw.vehicle,
          })),
        },
        signal,
      );
      return mapFleetResponse(body, input.stops.length, input.vehicles.length);
    };
    let mapped = await solve(hasWindows);
    // Jobs left over because of their time windows (not only capacity) would wrongly become
    // reload trips: plan without the windows and let the ETA warnings speak.
    if (hasWindows && mapped.unassigned.length > 0) mapped = await solve(false);
    return {
      routes: mapped.routes.map((r) => ({
        vehicleId: input.vehicles[r.vehicle]!.id,
        stopIds: r.jobs.map((j) => input.stops[j]!.id),
      })),
      unassigned: mapped.unassigned.map((j) => input.stops[j]!.id),
      approximate: false,
    };
  }

  async route(input: RouteInput): Promise<RouteResult> {
    assertValidPoints(input.depot, input.orderedStops);
    if (input.orderedStops.length === 0) return emptyRoute(input.depot, false);
    return this.directions(input.depot, input.orderedStops, AbortSignal.timeout(this.timeoutMs));
  }

  private async directions(
    depot: LatLng,
    ordered: LatLng[],
    signal: AbortSignal,
  ): Promise<RouteResult> {
    const points = [depot, ...ordered, depot].map(lngLat);
    const legs: RouteLeg[] = [];
    const coordinates: [number, number][] = [];
    // Chunks share their boundary point, so legs and geometry join without gaps.
    for (let start = 0; start < points.length - 1;) {
      const end = Math.min(start + MAX_DIRECTIONS_COORDINATES - 1, points.length - 1);
      const chunk = points.slice(start, end + 1);
      const body = await this.post(
        `/v2/directions/${this.profile}/geojson`,
        { coordinates: chunk },
        signal,
      );
      const mapped = mapDirectionsResponse(body, chunk.length);
      legs.push(...mapped.legs);
      coordinates.push(...(start === 0 ? mapped.coordinates : mapped.coordinates.slice(1)));
      start = end;
    }
    const geometry: RouteLineString = { type: "LineString", coordinates };
    return {
      legs,
      geometry,
      totalDistanceM: legs.reduce((sum, l) => sum + l.distanceM, 0),
      totalDurationS: legs.reduce((sum, l) => sum + l.durationS, 0),
      approximate: false,
    };
  }

  private async post(path: string, payload: unknown, signal: AbortSignal): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          Authorization: this.options.apiKey,
          Accept: "application/json, application/geo+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal,
      });
    } catch (error) {
      const timedOut =
        error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      throw timedOut
        ? new RoutingError("Routing service timed out", "TIMEOUT")
        : new RoutingError("Routing service is unreachable", "NETWORK");
    }
    if (!response.ok) {
      throw new RoutingError(
        `Routing service answered HTTP ${response.status}`,
        "HTTP",
        response.status,
      );
    }
    try {
      return await response.json();
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      throw new RoutingError(
        timedOut ? "Routing service timed out" : "Response was not JSON",
        timedOut ? "TIMEOUT" : "BAD_RESPONSE",
      );
    }
  }
}

function lngLat(p: LatLng): [number, number] {
  return [p.lng, p.lat];
}
