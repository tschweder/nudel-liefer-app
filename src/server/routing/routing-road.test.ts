// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { FallbackRoutingProvider } from "./fallback";
import { LocalHeuristicProvider } from "./heuristic";
import { HeuristicOrderRoutingProvider } from "./heuristic-order";
import { OrsRoutingProvider } from "./ors";
import {
  type DistributeInput,
  type OptimizeInput,
  type OptimizeResult,
  type RouteInput,
  type RouteResult,
  RoutingError,
  type RoutingProvider,
} from "./types";

// NUD-156: the self-hosted ORS serves /v2/directions but no /optimization, so the order comes from
// the heuristic and the legs from the road. Every provider here is a fake; nothing touches a network.

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(__dirname, "fixtures", name), "utf8"));
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const depot = { lat: 48.2082, lng: 16.3738 };
const input: OptimizeInput = {
  depot,
  stops: [
    { id: "a", location: { lat: 48.23, lng: 16.42 }, serviceSeconds: 300 },
    { id: "b", location: { lat: 48.2, lng: 16.35 }, serviceSeconds: 300 },
    { id: "c", location: { lat: 48.19, lng: 16.39 }, serviceSeconds: 300 },
  ],
};

const distributeInput: DistributeInput = {
  depot,
  vehicles: [
    { id: "v1", capacityKg: 500 },
    { id: "v2", capacityKg: 300 },
  ],
  stops: [
    { id: "a", location: { lat: 48.23, lng: 16.42 }, serviceSeconds: 300, weightKg: 200 },
    { id: "b", location: { lat: 48.2, lng: 16.35 }, serviceSeconds: 300, weightKg: 250 },
    { id: "c", location: { lat: 48.19, lng: 16.39 }, serviceSeconds: 300, weightKg: 250 },
  ],
};

/** Sentinels: none of these values can come from the heuristic, so they prove where they came from. */
const VIA: [number, number] = [16.5555, 48.3333];
const ROAD_DISTANCE_M = 4321;
const ROAD_DURATION_S = 654;

/** Fake road provider: one leg per hop plus a geometry the straight-line heuristic cannot produce. */
async function roadRoute(request: RouteInput): Promise<RouteResult> {
  return {
    legs: Array.from({ length: request.orderedStops.length + 1 }, (_, i) => ({
      distanceM: 100 + i,
      durationS: 10 + i,
    })),
    geometry: {
      type: "LineString",
      coordinates: [[16.3738, 48.2082], VIA, [16.3738, 48.2082]],
    },
    totalDistanceM: ROAD_DISTANCE_M,
    totalDurationS: ROAD_DURATION_S,
    approximate: false,
  };
}

function road() {
  return { route: vi.fn(roadRoute) };
}

/** Fake heuristic with a fixed order and distinguishable estimate values. */
function heuristicWith(order: string[]) {
  return {
    optimize: vi.fn(async (): Promise<OptimizeResult> => ({
      orderedStopIds: order,
      legs: [{ distanceM: 99, durationS: 9 }],
      geometry: {
        type: "LineString",
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      },
      totalDistanceM: 99,
      totalDurationS: 9,
      approximate: true,
    })),
    route: vi.fn(async (): Promise<RouteResult> => {
      throw new RoutingError("the heuristic route must not be called", "BAD_RESPONSE");
    }),
    distribute: vi.fn(
      async (): Promise<{
        routes: { vehicleId: string; stopIds: string[] }[];
        unassigned: string[];
        approximate: boolean;
      }> => ({
        routes: [{ vehicleId: "v1", stopIds: ["a", "b"] }],
        unassigned: ["c"],
        approximate: true,
      }),
    ),
  };
}

/** An `OrsRoutingProvider` pointed at the self-hosted base URL, with a stubbed transport. */
function orsAgainst(handler: () => Response | Promise<Response>) {
  const fetchMock = vi.fn<typeof fetch>(async () => handler());
  const ors = new OrsRoutingProvider({
    apiKey: "",
    baseUrl: "http://127.0.0.1:8082/ors",
    fetch: fetchMock,
  });
  return { ors, fetchMock };
}

describe("HeuristicOrderRoutingProvider (NUD-156: heuristic order, real road legs)", () => {
  it("takes the order from the heuristic and the legs, geometry and totals from the road", async () => {
    const remote = road();
    const result = await new HeuristicOrderRoutingProvider(
      remote,
      heuristicWith(["b", "a", "c"]),
    ).optimize(input);

    expect(result.orderedStopIds).toEqual(["b", "a", "c"]);
    expect(result.legs).toHaveLength(4);
    expect(result.legs[0]).toEqual({ distanceM: 100, durationS: 10 });
    expect(result.totalDistanceM).toBe(ROAD_DISTANCE_M);
    expect(result.totalDurationS).toBe(ROAD_DURATION_S);
    expect(result.geometry.coordinates[1]).toEqual(VIA);
    expect(result.approximate).toBe(false);
  });

  it("passes the heuristic's order on when it differs from the input order", async () => {
    const remote = road();
    await new HeuristicOrderRoutingProvider(remote, heuristicWith(["c", "b", "a"])).optimize(input);

    expect(remote.route).toHaveBeenCalledTimes(1);
    const request = remote.route.mock.calls[0]![0];
    expect(request.depot).toEqual(depot);
    expect(request.orderedStops).toEqual([
      input.stops[2]!.location,
      input.stops[1]!.location,
      input.stops[0]!.location,
    ]);
  });

  it("asks a real ORS for directions only, never for an optimization", async () => {
    const { ors, fetchMock } = orsAgainst(() => json(fixture("ors-directions.json")));
    const heuristic = new LocalHeuristicProvider();
    const result = await new HeuristicOrderRoutingProvider(ors, heuristic).optimize(input);

    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      "http://127.0.0.1:8082/ors/v2/directions/driving-car/geojson",
    ]);
    expect(result.orderedStopIds).toEqual((await heuristic.optimize(input)).orderedStopIds);
    expect(result.legs).toHaveLength(4);
    expect(result.approximate).toBe(false);
  });

  it("plans no stops without a directions request and is not approximate then", async () => {
    const { ors, fetchMock } = orsAgainst(() => json({}, 500));
    const result = await new HeuristicOrderRoutingProvider(
      ors,
      new LocalHeuristicProvider(),
    ).optimize({ depot, stops: [] });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ orderedStopIds: [], legs: [], totalDistanceM: 0 });
    expect(result.approximate).toBe(false);
  });

  it("delegates route() unchanged and keeps the given order", async () => {
    const remote = road();
    const heuristic = heuristicWith(["a", "b", "c"]);
    const provider = new HeuristicOrderRoutingProvider(remote, heuristic);
    const orderedStops = [input.stops[2]!.location, input.stops[0]!.location];

    const result = await provider.route({ depot, orderedStops });

    expect(result.totalDistanceM).toBe(ROAD_DISTANCE_M);
    expect(result.approximate).toBe(false);
    expect(remote.route.mock.calls[0]![0].orderedStops).toEqual(orderedStops);
    expect(heuristic.route).not.toHaveBeenCalled();
  });

  it("keeps the heuristic's capacity split and its own approximate flag", async () => {
    const remote = road();
    const heuristic = heuristicWith(["a", "b", "c"]);
    const result = await new HeuristicOrderRoutingProvider(remote, heuristic).distribute(
      distributeInput,
    );

    expect(result).toEqual({
      routes: [{ vehicleId: "v1", stopIds: ["a", "b"] }],
      unassigned: ["c"],
      approximate: true,
    });
    expect(heuristic.distribute).toHaveBeenCalledTimes(1);
    expect(remote.route).not.toHaveBeenCalled();
  });

  it("refuses a heuristic order that does not cover the input stops", async () => {
    const remote = road();
    await expect(
      new HeuristicOrderRoutingProvider(remote, heuristicWith(["a", "b"])).optimize(input),
    ).rejects.toMatchObject({ code: "BAD_RESPONSE" });
    await expect(
      new HeuristicOrderRoutingProvider(remote, heuristicWith(["a", "b", "zz"])).optimize(input),
    ).rejects.toMatchObject({ code: "BAD_RESPONSE" });
    expect(remote.route).not.toHaveBeenCalled();
  });
});

describe("FallbackRoutingProvider over the road provider (NUD-156)", () => {
  const withFallback = (primary: RoutingProvider, heuristic: RoutingProvider, log = vi.fn()) =>
    new FallbackRoutingProvider(primary, heuristic, log);

  it("ends in the pure heuristic result when the ORS instance is unreachable", async () => {
    const { ors, fetchMock } = orsAgainst(() => {
      throw new TypeError("fetch failed");
    });
    const heuristic = new LocalHeuristicProvider();
    const log = vi.fn();
    const provider = withFallback(
      new HeuristicOrderRoutingProvider(ors, heuristic),
      heuristic,
      log,
    );

    const result = await provider.optimize(input);

    expect(result).toEqual(await heuristic.optimize(input));
    expect(result.approximate).toBe(true);
    expect(result.geometry.coordinates).toHaveLength(input.stops.length + 2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("NETWORK"));
  });

  it("ends in the pure heuristic result when the self-hosted instance answers 404", async () => {
    const { ors, fetchMock } = orsAgainst(() => json({ error: "not found" }, 404));
    const heuristic = new LocalHeuristicProvider();
    const log = vi.fn();
    const provider = withFallback(
      new HeuristicOrderRoutingProvider(ors, heuristic),
      heuristic,
      log,
    );

    expect((await provider.optimize(input)).approximate).toBe(true);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("HTTP"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the road answer when the directions request works", async () => {
    const { ors } = orsAgainst(() => json(fixture("ors-directions.json")));
    const heuristic = new LocalHeuristicProvider();
    const provider = withFallback(new HeuristicOrderRoutingProvider(ors, heuristic), heuristic);

    const result = await provider.optimize(input);
    expect(result.approximate).toBe(false);
    expect(result.totalDistanceM).toBe(2100 + 1800 + 3901 + 4200);
  });

  it("still refuses invalid input instead of falling back", async () => {
    const { ors } = orsAgainst(() => json(fixture("ors-directions.json")));
    const heuristic = new LocalHeuristicProvider();
    const provider = withFallback(new HeuristicOrderRoutingProvider(ors, heuristic), heuristic);
    const duplicate = { depot, stops: [input.stops[0]!, input.stops[0]!] };

    await expect(provider.optimize(duplicate)).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
