import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  FallbackRoutingProvider,
  LocalHeuristicProvider,
  mapFleetResponse,
  OrsRoutingProvider,
} from "./index";
import { type DistributeInput, RoutingError } from "./types";

// Fixture HAND-WRITTEN from the documented VROOM response shape (not recorded live): live check in NUD-145.
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(__dirname, "fixtures", name), "utf8"));
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const depot = { lat: 48.2082, lng: 16.3738 };
const input: DistributeInput = {
  depot,
  vehicles: [
    { id: "v1", capacityKg: 500 },
    { id: "v2", capacityKg: 300 },
  ],
  stops: [
    { id: "a", location: { lat: 48.23, lng: 16.42 }, serviceSeconds: 300, weightKg: 200 },
    { id: "b", location: { lat: 48.2, lng: 16.35 }, serviceSeconds: 300, weightKg: 250 },
    { id: "c", location: { lat: 48.19, lng: 16.39 }, serviceSeconds: 300, weightKg: 250 },
    { id: "d", location: { lat: 48.17, lng: 16.45 }, serviceSeconds: 300, weightKg: 400 },
  ],
};

describe("mapFleetResponse", () => {
  it("maps routes per vehicle and the unassigned jobs to zero-based indices", () => {
    expect(mapFleetResponse(fixture("ors-optimization-fleet.json"), 4, 2)).toEqual({
      routes: [
        { vehicle: 1, jobs: [0] },
        { vehicle: 0, jobs: [2, 1] },
      ],
      unassigned: [3],
    });
  });

  it("rejects a job that is missing or listed twice", () => {
    const body = fixture("ors-optimization-fleet.json") as { unassigned: unknown[] };
    expect(() => mapFleetResponse({ ...body, unassigned: [] }, 4, 2)).toThrow(RoutingError);
    expect(() => mapFleetResponse(fixture("ors-optimization-fleet.json"), 3, 2)).toThrow(
      RoutingError,
    );
    expect(() => mapFleetResponse({ routes: "x" }, 1, 1)).toThrow(RoutingError);
  });
});

describe("OrsRoutingProvider.distribute", () => {
  it("sends capacities and weights and maps the fixture back to ids", async () => {
    const fetchMock = vi.fn(async () => json(fixture("ors-optimization-fleet.json")));
    const ors = new OrsRoutingProvider({
      apiKey: "KEY",
      fetch: fetchMock as unknown as typeof fetch,
    });
    const result = await ors.distribute(input);

    expect(result).toEqual({
      routes: [
        { vehicleId: "v2", stopIds: ["a"] },
        { vehicleId: "v1", stopIds: ["c", "b"] },
      ],
      unassigned: ["d"],
      approximate: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openrouteservice.org/optimization");
    const body = JSON.parse(init.body as string);
    expect(body.vehicles.map((v: { capacity: number[] }) => v.capacity)).toEqual([[500], [300]]);
    expect(body.jobs.map((j: { delivery: number[] }) => j.delivery)).toEqual([
      [200],
      [250],
      [250],
      [400],
    ]);
  });

  it("makes no request for no stops and refuses bad vehicles", async () => {
    const fetchMock = vi.fn();
    const ors = new OrsRoutingProvider({
      apiKey: "K",
      fetch: fetchMock as unknown as typeof fetch,
    });
    await expect(ors.distribute({ ...input, stops: [] })).resolves.toEqual({
      routes: [],
      unassigned: [],
      approximate: false,
    });
    await expect(
      ors.distribute({ ...input, vehicles: [{ id: "v", capacityKg: 0 }] }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(ors.distribute({ ...input, vehicles: [] })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("LocalHeuristicProvider.distribute (fallback, no ORS)", () => {
  it("keeps every vehicle within its capacity and flags the result approximate", async () => {
    const result = await new LocalHeuristicProvider().distribute(input);
    expect(result.approximate).toBe(true);
    const weight = new Map(input.stops.map((s) => [s.id, s.weightKg]));
    const cap = new Map(input.vehicles.map((v) => [v.id, v.capacityKg]));
    for (const route of result.routes) {
      const load = route.stopIds.reduce((sum, id) => sum + weight.get(id)!, 0);
      expect(load).toBeLessThanOrEqual(cap.get(route.vehicleId)!);
    }
    const all = [...result.routes.flatMap((r) => r.stopIds), ...result.unassigned].sort();
    expect(all).toEqual(["a", "b", "c", "d"]);
  });
});

describe("FallbackRoutingProvider.distribute", () => {
  it("falls back to the heuristic when ORS fails", async () => {
    const failing = new OrsRoutingProvider({
      apiKey: "K",
      fetch: (async () => json({}, 500)) as unknown as typeof fetch,
    });
    const log = vi.fn();
    const provider = new FallbackRoutingProvider(failing, new LocalHeuristicProvider(), log);
    const result = await provider.distribute(input);
    expect(result.approximate).toBe(true);
    expect(log).toHaveBeenCalledOnce();
  });
});
