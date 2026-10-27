import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { OrsRoutingProvider } from "./index";
import { timeWindowFields } from "./ors";
import type { OptimizeInput } from "./types";

// Fixtures are hand-written from the documented VROOM shape; live check in NUD-145.
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(__dirname, "fixtures", name), "utf8"));
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const input: OptimizeInput = {
  depot: { lat: 48.2082, lng: 16.3738 },
  departureS: 7 * 3600,
  stops: [
    {
      id: "a",
      location: { lat: 48.23, lng: 16.42 },
      serviceSeconds: 300,
      timeWindow: { fromS: 8 * 3600, toS: 11 * 3600 },
    },
    { id: "b", location: { lat: 48.2, lng: 16.35 }, serviceSeconds: 300 },
    { id: "c", location: { lat: 48.19, lng: 16.39 }, serviceSeconds: 300 },
  ],
};

describe("time windows for the optimiser (NUD-148)", () => {
  it("maps stop windows to job time_windows and a vehicle window from the departure", () => {
    const tw = timeWindowFields(input.stops, input.departureS, true);
    expect(tw.job(0)).toEqual({ time_windows: [[28_800, 39_600]] });
    expect(tw.job(1)).toEqual({});
    expect(tw.vehicle).toEqual({ time_window: [25_200, 111_600] });
    expect(timeWindowFields(input.stops, input.departureS, false).vehicle).toEqual({});
    expect(timeWindowFields([{}], 0, true).vehicle).toEqual({});
  });

  it("sends the windows to ORS", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) =>
      String(url).endsWith("/optimization")
        ? json(fixture("ors-optimization.json"))
        : json(fixture("ors-directions.json")),
    );
    const ors = new OrsRoutingProvider({
      apiKey: "K",
      fetch: fetchMock as unknown as typeof fetch,
    });
    await ors.optimize(input);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.jobs[0].time_windows).toEqual([[28_800, 39_600]]);
    expect(body.jobs[1].time_windows).toBeUndefined();
    expect(body.vehicles[0].time_window).toEqual([25_200, 111_600]);
  });

  it("plans again without the windows when they cannot all be met", async () => {
    let optimizations = 0;
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith("/optimization")) {
        optimizations += 1;
        return json(
          optimizations === 1
            ? fixture("ors-optimization-unassigned.json")
            : fixture("ors-optimization.json"),
        );
      }
      return json(fixture("ors-directions.json"));
    });
    const ors = new OrsRoutingProvider({
      apiKey: "K",
      fetch: fetchMock as unknown as typeof fetch,
    });
    const result = await ors.optimize(input);
    expect(result.orderedStopIds).toHaveLength(3);
    const second = JSON.parse(
      (fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body as string,
    );
    expect(second.jobs.some((j: { time_windows?: unknown }) => j.time_windows)).toBe(false);
  });
});
