// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { FallbackRoutingProvider } from "./fallback";
import { LocalHeuristicProvider } from "./heuristic";
import { getRoutingProvider, parseProfile, setRoutingProviderForTests } from "./index";
import {
  mapDirectionsResponse,
  mapOptimizationResponse,
  MAX_DIRECTIONS_COORDINATES,
  OrsRoutingProvider,
} from "./ors";
import {
  MAX_STOPS,
  type OptimizeInput,
  ROUTING_TIMEOUT_MS,
  RoutingError,
  type RoutingProvider,
} from "./types";

// Fixtures are HAND-WRITTEN from the documented ORS / VROOM response shapes, not recorded live.
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

/** Fake ORS: optimization then directions fixtures. */
function orsFetch() {
  return vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    if (u.endsWith("/optimization")) return json(fixture("ors-optimization.json"));
    if (u.includes("/v2/directions/")) return json(fixture("ors-directions.json"));
    return json({}, 404);
  });
}

afterEach(() => {
  setRoutingProviderForTests(undefined);
  vi.restoreAllMocks();
});

describe("mapOptimizationResponse", () => {
  it("returns the job order as zero-based indices", () => {
    expect(mapOptimizationResponse(fixture("ors-optimization.json"), 3)).toEqual([1, 2, 0]);
  });

  it("rejects unassigned jobs, wrong shapes and incomplete orders", () => {
    expect(() => mapOptimizationResponse(fixture("ors-optimization-unassigned.json"), 3)).toThrow(
      expect.objectContaining({ code: "NO_ROUTE" }),
    );
    expect(() => mapOptimizationResponse({ nope: 1 }, 3)).toThrow(
      expect.objectContaining({ code: "BAD_RESPONSE" }),
    );
    expect(() => mapOptimizationResponse(fixture("ors-optimization.json"), 4)).toThrow(
      expect.objectContaining({ code: "BAD_RESPONSE" }),
    );
  });
});

describe("mapDirectionsResponse", () => {
  it("maps legs (rounded) and drops elevation from the geometry", () => {
    const mapped = mapDirectionsResponse(fixture("ors-directions.json"), 5);
    expect(mapped.legs).toEqual([
      { distanceM: 2100, durationS: 420 },
      { distanceM: 1800, durationS: 360 },
      { distanceM: 3901, durationS: 701 },
      { distanceM: 4200, durationS: 810 },
    ]);
    expect(mapped.coordinates[0]).toEqual([16.3738, 48.2082]);
  });

  it("rejects a segment count that does not match the request", () => {
    expect(() => mapDirectionsResponse(fixture("ors-directions.json"), 4)).toThrow(
      expect.objectContaining({ code: "BAD_RESPONSE" }),
    );
    expect(() => mapDirectionsResponse({ features: [] }, 5)).toThrow(RoutingError);
  });
});

describe("OrsRoutingProvider", () => {
  it("optimizes via VROOM then fetches directions, in that order", async () => {
    const fetchMock = orsFetch();
    const ors = new OrsRoutingProvider({
      apiKey: "KEY",
      fetch: fetchMock as unknown as typeof fetch,
    });
    const result = await ors.optimize(input);

    expect(result.orderedStopIds).toEqual(["b", "c", "a"]);
    expect(result.approximate).toBe(false);
    expect(result.legs).toHaveLength(4);
    expect(result.totalDistanceM).toBe(2100 + 1800 + 3901 + 4200);
    expect(result.totalDurationS).toBe(420 + 360 + 701 + 810);
    expect(result.geometry.type).toBe("LineString");

    const [optUrl, optInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(optUrl).toBe("https://api.openrouteservice.org/optimization");
    expect((optInit.headers as Record<string, string>).Authorization).toBe("KEY");
    expect(optUrl).not.toContain("KEY");
    const optBody = JSON.parse(optInit.body as string);
    expect(optBody.vehicles).toEqual([
      { id: 1, profile: "driving-car", start: [16.3738, 48.2082], end: [16.3738, 48.2082] },
    ]);
    expect(optBody.jobs[0]).toEqual({ id: 1, location: [16.42, 48.23], service: 300 });

    const [dirUrl, dirInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(dirUrl).toBe("https://api.openrouteservice.org/v2/directions/driving-car/geojson");
    // order b, c, a between depot and depot, longitude first
    expect(JSON.parse(dirInit.body as string).coordinates).toEqual([
      [16.3738, 48.2082],
      [16.35, 48.2],
      [16.39, 48.19],
      [16.42, 48.23],
      [16.3738, 48.2082],
    ]);
  });

  it("uses the configured profile for both requests", async () => {
    const fetchMock = orsFetch();
    const ors = new OrsRoutingProvider({
      apiKey: "K",
      profile: "driving-hgv",
      fetch: fetchMock as unknown as typeof fetch,
    });
    await ors.optimize(input);
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls[1]).toContain("/v2/directions/driving-hgv/geojson");
    const first = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(first[1].body as string);
    expect(body.vehicles[0].profile).toBe("driving-hgv");
  });

  it("route() only calls directions, in the given order", async () => {
    const fetchMock = orsFetch();
    const ors = new OrsRoutingProvider({
      apiKey: "K",
      fetch: fetchMock as unknown as typeof fetch,
    });
    const result = await ors.route({
      depot,
      orderedStops: input.stops.slice(0, 3).map((s) => s.location),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.legs).toHaveLength(4);
    expect(result.approximate).toBe(false);
  });

  it("splits directions into chunks of at most 50 coordinates", async () => {
    const stops = Array.from({ length: MAX_STOPS }, (_, i) => ({
      id: `s${i}`,
      location: { lat: 48.2 + i * 0.001, lng: 16.4 },
      serviceSeconds: 60,
    }));
    const calls: number[] = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      if (String(url).endsWith("/optimization")) {
        return json({
          unassigned: [],
          routes: [
            {
              steps: [
                { type: "start" },
                ...stops.map((_, i) => ({ type: "job", job: i + 1 })),
                { type: "end" },
              ],
            },
          ],
        });
      }
      const coords = body.coordinates as [number, number][];
      calls.push(coords.length);
      return json({
        features: [
          {
            geometry: { type: "LineString", coordinates: coords },
            properties: { segments: coords.slice(1).map(() => ({ distance: 100, duration: 10 })) },
          },
        ],
      });
    });
    const ors = new OrsRoutingProvider({
      apiKey: "K",
      fetch: fetchMock as unknown as typeof fetch,
    });
    const result = await ors.optimize({ depot, stops });
    expect(Math.max(...calls)).toBeLessThanOrEqual(MAX_DIRECTIONS_COORDINATES);
    expect(calls.length).toBeGreaterThan(1);
    expect(result.legs).toHaveLength(MAX_STOPS + 1);
    expect(result.geometry.coordinates).toHaveLength(MAX_STOPS + 2);
    expect(result.totalDistanceM).toBe((MAX_STOPS + 1) * 100);
  });

  it("maps a stalled request to TIMEOUT", async () => {
    const hang = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
        }),
    );
    const ors = new OrsRoutingProvider({
      apiKey: "K",
      timeoutMs: 30,
      fetch: hang as unknown as typeof fetch,
    });
    await expect(ors.optimize(input)).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("maps HTTP errors, network errors and non-JSON bodies", async () => {
    const make = (f: () => Promise<Response>) =>
      new OrsRoutingProvider({ apiKey: "K", fetch: f as unknown as typeof fetch });
    await expect(make(async () => json({}, 403)).optimize(input)).rejects.toMatchObject({
      code: "HTTP",
      status: 403,
    });
    await expect(
      make(async () => {
        throw new TypeError("fetch failed");
      }).optimize(input),
    ).rejects.toMatchObject({ code: "NETWORK" });
    await expect(make(async () => new Response("<html>")).optimize(input)).rejects.toMatchObject({
      code: "BAD_RESPONSE",
    });
  });

  it("returns an empty route for no stops without calling ORS", async () => {
    const fetchMock = vi.fn();
    const ors = new OrsRoutingProvider({
      apiKey: "K",
      fetch: fetchMock as unknown as typeof fetch,
    });
    const result = await ors.optimize({ depot, stops: [] });
    expect(result).toMatchObject({ orderedStopIds: [], legs: [], totalDistanceM: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("has an 8 s default deadline", () => {
    expect(ROUTING_TIMEOUT_MS).toBe(8000);
  });
});

describe("LocalHeuristicProvider", () => {
  const heuristic = new LocalHeuristicProvider();

  it("orders all stops, flags approximate and returns n + 1 legs", async () => {
    const result = await heuristic.optimize(input);
    expect([...result.orderedStopIds].sort()).toEqual(["a", "b", "c"]);
    expect(result.approximate).toBe(true);
    expect(result.legs).toHaveLength(4);
    expect(result.geometry.coordinates).toHaveLength(5);
    expect(result.totalDistanceM).toBe(result.legs.reduce((s, l) => s + l.distanceM, 0));
  });

  it("route() keeps the given order", async () => {
    const result = await heuristic.route({
      depot,
      orderedStops: [input.stops[2]!.location, input.stops[0]!.location],
    });
    expect(result.legs).toHaveLength(3);
    expect(result.geometry.coordinates[1]).toEqual([16.39, 48.19]);
    expect(result.approximate).toBe(true);
  });

  it("raises a documented error above 50 stops", async () => {
    const stops = Array.from({ length: MAX_STOPS + 1 }, (_, i) => ({
      id: `s${i}`,
      location: { lat: 48.2, lng: 16.4 },
      serviceSeconds: 0,
    }));
    await expect(heuristic.optimize({ depot, stops })).rejects.toMatchObject({
      code: "TOO_MANY_STOPS",
      message: expect.stringContaining("at most 50 stops"),
    });
  });

  it("rejects duplicate ids and invalid coordinates", async () => {
    await expect(
      heuristic.optimize({ depot, stops: [input.stops[0]!, input.stops[0]!] }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      heuristic.optimize({ depot: { lat: 99, lng: 0 }, stops: [] }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("FallbackRoutingProvider", () => {
  const failing = (code: RoutingError["code"]): RoutingProvider => ({
    optimize: async () => {
      throw new RoutingError("boom", code);
    },
    route: async () => {
      throw new RoutingError("boom", code);
    },
    distribute: async () => {
      throw new RoutingError("boom", code);
    },
  });

  it("falls back on a timeout and reports approximate", async () => {
    const hang = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
        }),
    );
    const log = vi.fn();
    const provider = new FallbackRoutingProvider(
      new OrsRoutingProvider({
        apiKey: "K",
        timeoutMs: 30,
        fetch: hang as unknown as typeof fetch,
      }),
      new LocalHeuristicProvider(),
      log,
    );
    const result = await provider.optimize(input);
    expect(result.approximate).toBe(true);
    expect(result.orderedStopIds).toHaveLength(3);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("TIMEOUT"));
  });

  it.each(["HTTP", "NETWORK", "BAD_RESPONSE", "NO_ROUTE"] as const)(
    "falls back on %s for optimize and route",
    async (code) => {
      const provider = new FallbackRoutingProvider(
        failing(code),
        new LocalHeuristicProvider(),
        vi.fn(),
      );
      expect((await provider.optimize(input)).approximate).toBe(true);
      expect(
        (await provider.route({ depot, orderedStops: [input.stops[0]!.location] })).approximate,
      ).toBe(true);
    },
  );

  it("does not fall back on invalid input or too many stops", async () => {
    for (const code of ["INVALID_INPUT", "TOO_MANY_STOPS"] as const) {
      const provider = new FallbackRoutingProvider(failing(code), new LocalHeuristicProvider());
      await expect(provider.optimize(input)).rejects.toMatchObject({ code });
    }
  });

  it("passes the ORS result through when ORS works", async () => {
    const provider = new FallbackRoutingProvider(
      new OrsRoutingProvider({ apiKey: "K", fetch: orsFetch() as unknown as typeof fetch }),
      new LocalHeuristicProvider(),
    );
    expect((await provider.optimize(input)).approximate).toBe(false);
  });
});

describe("getRoutingProvider", () => {
  it("without ORS_API_KEY uses the heuristic and warns once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const provider = getRoutingProvider({});
    expect(getRoutingProvider({})).toBe(provider);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("ORS_API_KEY");
    expect((await provider.optimize(input)).approximate).toBe(true);
  });

  it("with a key returns a provider that falls back", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("offline");
    });
    try {
      const provider = getRoutingProvider({ ORS_API_KEY: "K" });
      expect(provider).toBeInstanceOf(FallbackRoutingProvider);
      expect((await provider.optimize(input)).approximate).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("parses the profile and defaults to driving-car", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseProfile(undefined)).toBe("driving-car");
    expect(parseProfile(" driving-hgv ")).toBe("driving-hgv");
    expect(parseProfile("cycling-regular")).toBe("driving-car");
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
