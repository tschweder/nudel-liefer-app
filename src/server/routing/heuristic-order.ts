import {
  type DistributeInput,
  type DistributeResult,
  type LatLng,
  type OptimizeInput,
  type OptimizeResult,
  type RouteInput,
  type RouteResult,
  RoutingError,
  type RoutingProvider,
} from "./types";

/**
 * Real road data for the visiting order that the local heuristic chose (NUD-156).
 *
 * A self-hosted openrouteservice serves `/v2/directions` but no `/optimization` (VROOM is a
 * separate service of its own), so the order cannot come from the road data. It comes from
 * `LocalHeuristicProvider` (nearest neighbour + 2-opt, cannot fail), and `remote.route()` then
 * computes the legs, the LineString geometry and the totals for exactly that order. The result is
 * therefore not `approximate`: the distances and the drawn route are real road data, only the
 * visiting order is a heuristic best guess.
 *
 * Only `route()` of the remote provider is used. `distribute()` stays the heuristic's answer,
 * because the capacity split over several vehicles is not something the self-hosted instance
 * offers; its `approximate` flag is passed through unchanged, so it stays honest. A remote failure
 * surfaces as its own `RoutingError`, so `FallbackRoutingProvider` still degrades to the pure
 * heuristic result (`approximate: true`, straight-line geometry).
 */
export class HeuristicOrderRoutingProvider implements RoutingProvider {
  constructor(
    private readonly remote: Pick<RoutingProvider, "route">,
    private readonly heuristic: RoutingProvider,
  ) {}

  async optimize(input: OptimizeInput): Promise<OptimizeResult> {
    const order = await this.heuristic.optimize(input);
    const byId = new Map(input.stops.map((stop) => [stop.id, stop]));
    const orderedStops: LatLng[] = [];
    for (const id of order.orderedStopIds) {
      const stop = byId.get(id);
      if (!stop) {
        throw new RoutingError(
          "The heuristic returned a stop that is not in the input",
          "BAD_RESPONSE",
        );
      }
      orderedStops.push(stop.location);
    }
    if (orderedStops.length !== input.stops.length) {
      throw new RoutingError("The heuristic left stops out of its order", "BAD_RESPONSE");
    }
    const route = await this.remote.route({ depot: input.depot, orderedStops });
    return { orderedStopIds: order.orderedStopIds, ...route };
  }

  /** Same order, real road legs: delegated unchanged (`OrsRoutingProvider.route`). */
  route(input: RouteInput): Promise<RouteResult> {
    return this.remote.route(input);
  }

  /** Capacity split and the per-vehicle order stay the heuristic's; its `approximate` is kept. */
  distribute(input: DistributeInput): Promise<DistributeResult> {
    return this.heuristic.distribute(input);
  }
}
