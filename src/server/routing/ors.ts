import { z } from "zod";

import {
  assertValidOptimizeInput,
  assertValidPoints,
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
} from "./types";

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
    const body = await this.post(
      "/optimization",
      {
        jobs: input.stops.map((s, i) => ({
          id: i + 1,
          location: lngLat(s.location),
          service: Math.round(s.serviceSeconds),
        })),
        vehicles: [{ id: 1, profile: this.profile, start: depot, end: depot }],
      },
      signal,
    );
    const order = mapOptimizationResponse(body, input.stops.length);
    const ordered = order.map((i) => input.stops[i]!);
    const route = await this.directions(
      input.depot,
      ordered.map((s) => s.location),
      signal,
    );
    return { orderedStopIds: ordered.map((s) => s.id), ...route };
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
