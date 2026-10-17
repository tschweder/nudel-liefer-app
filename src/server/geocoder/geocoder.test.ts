// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { CachingGeocoder, LruCache } from "./cache";
import { FakeGeocoder } from "./fake";
import { getGeocoder, parseCountries, setGeocoderForTests } from "./index";
import { mapOrsResponse, OrsGeocoder } from "./ors";
import { GeocoderError, normalizeAddress } from "./types";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(__dirname, "fixtures", name), "utf8"));

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("normalizeAddress", () => {
  it("trims, collapses whitespace and lower-cases", () => {
    expect(normalizeAddress("  Stephansplatz   1,\n1010 Wien ")).toBe("stephansplatz 1, 1010 wien");
  });
});

describe("FakeGeocoder", () => {
  const fake = new FakeGeocoder();

  it("is deterministic and ignores case and spacing", async () => {
    const a = await fake.search("Stephansplatz 1, 1010 Wien");
    const b = await fake.search("  stephansplatz   1, 1010 WIEN ");
    expect(a).toHaveLength(1);
    expect(b).toEqual([{ ...a[0], label: "stephansplatz 1, 1010 WIEN" }]);
    expect({ lat: b[0]!.lat, lng: b[0]!.lng }).toEqual({ lat: a[0]!.lat, lng: a[0]!.lng });
  });

  it("gives different addresses different points, all around Vienna", async () => {
    const points = await Promise.all(
      ["Hauptstr. 1", "Hauptstr. 2", "Ringstr. 10", "Nudelweg 5", "Zhongshan Road 3"].map(
        async (q) => (await fake.search(q))[0]!,
      ),
    );
    expect(new Set(points.map((p) => `${p.lat},${p.lng}`)).size).toBe(points.length);
    for (const p of points) {
      expect(Math.abs(p.lat - 48.2082)).toBeLessThanOrEqual(0.08);
      expect(Math.abs(p.lng - 16.3738)).toBeLessThanOrEqual(0.12);
      expect(p.confidence).toBeLessThan(0.5);
    }
  });

  it("returns nothing for an empty address and echoes coordinates on reverse", async () => {
    expect(await fake.search("   ")).toEqual([]);
    const r = await fake.reverse(48.2, 16.3);
    expect(r).toMatchObject({ lat: 48.2, lng: 16.3 });
    expect(await fake.reverse(Number.NaN, 1)).toBeNull();
  });
});

describe("mapOrsResponse (recorded-format fixture)", () => {
  it("maps features to candidates with [lon,lat] swapped to lat/lng", () => {
    expect(mapOrsResponse(fixture("ors-search-vienna.json"))).toEqual([
      { label: "Stephansplatz 1, Wien, Österreich", lat: 48.208492, lng: 16.372, confidence: 1 },
      { label: "Stephansplatz, Wien, Österreich", lat: 48.2086, lng: 16.3735, confidence: 0.6 },
    ]);
  });

  it("handles no results and rejects unexpected shapes", () => {
    expect(mapOrsResponse(fixture("ors-empty.json"))).toEqual([]);
    expect(() => mapOrsResponse({ error: "nope" })).toThrow(GeocoderError);
    expect(() => mapOrsResponse({ features: [{ geometry: { type: "Polygon" } }] })).toThrow(
      GeocoderError,
    );
  });
});

describe("OrsGeocoder", () => {
  const make = (fetchFn: typeof fetch, extra: object = {}) =>
    new OrsGeocoder({ apiKey: "secret-key", fetch: fetchFn, ...extra });

  it("calls /geocode/search with text, boundary.country (default AT,DE) and the key as header", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(fixture("ors-search-vienna.json")));
    const result = await make(fetchFn as unknown as typeof fetch).search(
      "Stephansplatz 1,  1010 Wien",
    );
    expect(result).toHaveLength(2);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://api.openrouteservice.org/geocode/search");
    expect(parsed.searchParams.get("text")).toBe("Stephansplatz 1, 1010 Wien");
    expect(parsed.searchParams.get("boundary.country")).toBe("AT,DE");
    expect(url).not.toContain("secret-key");
    expect((init.headers as Record<string, string>).Authorization).toBe("secret-key");
  });

  it("uses configured countries and reverse maps the first feature", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(fixture("ors-reverse-vienna.json")));
    const geocoder = make(fetchFn as unknown as typeof fetch, { countries: ["CH"] });
    const r = await geocoder.reverse(48.20849, 16.37201);
    expect(r).toMatchObject({ label: "Stephansplatz 1, Wien, Österreich", lat: 48.20849 });
    const url = new URL((fetchFn.mock.calls[0] as unknown as [string])[0]);
    expect(url.pathname).toBe("/geocode/reverse");
    expect(url.searchParams.get("point.lat")).toBe("48.20849");
    expect(url.searchParams.get("point.lon")).toBe("16.37201");
    const empty = make((async () => jsonResponse(fixture("ors-empty.json"))) as typeof fetch);
    expect(await empty.reverse(1, 1)).toBeNull();
  });

  it("does not call the network for an empty address and validates input", async () => {
    const fetchFn = vi.fn();
    const g = make(fetchFn as unknown as typeof fetch);
    expect(await g.search("  ")).toEqual([]);
    await expect(g.search("x".repeat(301))).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(g.reverse(95, 0)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("retries once on a 5xx and on a network error, then succeeds", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response("oops", { status: 503 }))
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValue(jsonResponse(fixture("ors-empty.json")));
    const g = make(fetchFn as unknown as typeof fetch, { retries: 2 });
    expect(await g.search("a")).toEqual([]);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("gives up after the single default retry", async () => {
    const fetchFn = vi.fn(async () => new Response("down", { status: 502 }));
    await expect(make(fetchFn as unknown as typeof fetch).search("a")).rejects.toMatchObject({
      code: "HTTP",
      status: 502,
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("does not retry client errors (bad key, quota)", async () => {
    const fetchFn = vi.fn(async () => new Response("forbidden", { status: 403 }));
    await expect(make(fetchFn as unknown as typeof fetch).search("a")).rejects.toMatchObject({
      code: "HTTP",
      status: 403,
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("times out after the configured time and reports TIMEOUT", async () => {
    const fetchFn = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal!.addEventListener("abort", () => reject(init.signal!.reason));
        }),
    );
    const g = make(fetchFn as unknown as typeof fetch, { timeoutMs: 20, retries: 1 });
    await expect(g.search("a")).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("reports a non-JSON body as BAD_RESPONSE without retrying", async () => {
    const fetchFn = vi.fn(async () => new Response("<html>", { status: 200 }));
    await expect(make(fetchFn as unknown as typeof fetch).search("a")).rejects.toMatchObject({
      code: "BAD_RESPONSE",
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe("caching", () => {
  it("LruCache evicts the least recently used entry", () => {
    const lru = new LruCache<number>(2);
    lru.set("a", 1);
    lru.set("b", 2);
    lru.get("a");
    lru.set("c", 3);
    expect(lru.get("b")).toBeUndefined();
    expect(lru.get("a")).toBe(1);
    expect(lru.size).toBe(2);
  });

  it("asks the inner geocoder once per normalized address and does not cache failures", async () => {
    const search = vi
      .fn()
      .mockRejectedValueOnce(new GeocoderError("down", "NETWORK"))
      .mockResolvedValue([{ label: "L", lat: 1, lng: 2, confidence: 1 }]);
    const reverse = vi.fn().mockResolvedValue(null);
    const cached = new CachingGeocoder({ search, reverse });
    await expect(cached.search("Hauptstr. 1")).rejects.toThrow();
    await cached.search("Hauptstr. 1");
    await cached.search("  hauptstr.   1 ");
    expect(search).toHaveBeenCalledTimes(2);
    await cached.reverse(48.2000001, 16.3);
    await cached.reverse(48.2000002, 16.3);
    expect(reverse).toHaveBeenCalledTimes(1);
  });

  it("returns copies so callers cannot corrupt the cache", async () => {
    const cached = new CachingGeocoder(new FakeGeocoder());
    const first = await cached.search("Hauptstr. 1");
    first[0]!.lat = 0;
    expect((await cached.search("Hauptstr. 1"))[0]!.lat).not.toBe(0);
  });
});

describe("getGeocoder", () => {
  afterEach(() => {
    setGeocoderForTests(undefined);
    vi.restoreAllMocks();
  });

  it("falls back to the Fake and warns exactly once when ORS_API_KEY is missing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const g = getGeocoder({});
    getGeocoder({ ORS_API_KEY: "  " });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("ORS_API_KEY");
    const fake = await new FakeGeocoder().search("Hauptstr. 1");
    expect((await g.search("Hauptstr. 1"))[0]).toMatchObject({
      lat: fake[0]!.lat,
      lng: fake[0]!.lng,
    });
    expect(getGeocoder({})).toBe(getGeocoder({}));
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("uses ORS (no warning) when a key is set", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchFn = vi.fn(async () => jsonResponse(fixture("ors-search-vienna.json")));
    vi.stubGlobal("fetch", fetchFn);
    try {
      const g = getGeocoder({ ORS_API_KEY: "k", ORS_GEOCODE_COUNTRIES: "at, ch" });
      await g.search("Stephansplatz 1");
      expect(
        new URL((fetchFn.mock.calls[0] as unknown as [string])[0]).searchParams.get(
          "boundary.country",
        ),
      ).toBe("AT,CH");
      expect(warn).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("parseCountries ignores junk and defaults to AT,DE", () => {
    expect(parseCountries(undefined)).toEqual(["AT", "DE"]);
    expect(parseCountries("xx1, , de")).toEqual(["DE"]);
  });
});
