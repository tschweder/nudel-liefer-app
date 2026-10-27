// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { getGeocoder, setGeocoderForTests } from "./index";
import { mapPhotonResponse, PhotonGeocoder } from "./photon";
import { GeocoderError } from "./types";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(__dirname, "fixtures", name), "utf8"));

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("mapPhotonResponse", () => {
  it("maps the recorded Photon answer for 'Stephansplatz 1, 1010 Wien' (real capture, NUD-157)", () => {
    expect(mapPhotonResponse(fixture("photon-search-vienna.json"))).toEqual([
      {
        // name and street are both "Stephansplatz": the duplicate part is dropped
        label: "Stephansplatz, 1010 Wien, Österreich",
        lat: 48.2084639,
        lng: 16.3720438,
        confidence: 1,
      },
      {
        label: "Stephansplatz, Stock-im-Eisen-Platz, 1010 Wien, Österreich",
        lat: 48.2080838,
        lng: 16.3715166,
        confidence: 1,
      },
    ]);
  });

  it("builds the label from the parts Photon filled and maps the hit granularity to a confidence", () => {
    const house = mapPhotonResponse({
      features: [
        {
          geometry: { type: "Point", coordinates: [16.37, 48.2] },
          properties: {
            street: "Hauptstraße",
            housenumber: "12",
            postcode: "1010",
            city: "Wien",
            country: "Österreich",
            type: "house",
          },
        },
      ],
    });
    expect(house).toEqual([
      { label: "Hauptstraße 12, 1010 Wien, Österreich", lat: 48.2, lng: 16.37, confidence: 1 },
    ]);
    // A street-level hit has no house number and is the weaker match.
    expect(
      mapPhotonResponse({
        features: [
          {
            geometry: { type: "Point", coordinates: [16.37, 48.2] },
            properties: { street: "Hauptstraße", postcode: "1010", city: "Wien", type: "street" },
          },
        ],
      }),
    ).toEqual([{ label: "Hauptstraße, 1010 Wien", lat: 48.2, lng: 16.37, confidence: 0.8 }]);
  });

  it("accepts an empty result and a provider-sent confidence", () => {
    expect(mapPhotonResponse({ features: [] })).toEqual([]);
    expect(
      mapPhotonResponse({
        features: [
          {
            geometry: { type: "Point", coordinates: [16.37, 48.2] },
            properties: { city: "Wien", confidence: 0.42 },
          },
        ],
      }),
    ).toEqual([{ label: "Wien", lat: 48.2, lng: 16.37, confidence: 0.42 }]);
  });

  it("labels a hit without any address part and rejects unexpected shapes", () => {
    expect(
      mapPhotonResponse({
        features: [{ geometry: { type: "Point", coordinates: [16.37, 48.2] }, properties: {} }],
      }),
    ).toEqual([{ label: "Unbekannte Adresse", lat: 48.2, lng: 16.37, confidence: 0 }]);
    expect(() => mapPhotonResponse({ error: "nope" })).toThrow(GeocoderError);
    expect(() => mapPhotonResponse({ features: [{ geometry: { type: "Polygon" } }] })).toThrow(
      GeocoderError,
    );
  });
});

describe("PhotonGeocoder", () => {
  const make = (fetchFn: typeof fetch, extra: object = {}) =>
    new PhotonGeocoder({ baseUrl: "http://127.0.0.1:2322", fetch: fetchFn, ...extra });

  it("calls /api with q, limit and lang, and sends no Authorization header", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(fixture("photon-search-vienna.json")));
    const result = await make(fetchFn as unknown as typeof fetch).search(
      "Stephansplatz 1,  1010 Wien",
    );
    expect(result).toHaveLength(2);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("http://127.0.0.1:2322/api");
    expect(parsed.searchParams.get("q")).toBe("Stephansplatz 1, 1010 Wien");
    expect(parsed.searchParams.get("limit")).toBe("5");
    expect(parsed.searchParams.get("lang")).toBe("de");
    expect(init.headers).toEqual({ Accept: "application/json" });
  });

  it("honours baseUrl, lang and maxResults", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(fixture("photon-search-vienna.json")));
    const geocoder = make(fetchFn as unknown as typeof fetch, {
      baseUrl: "http://photon.test:2322///",
      lang: "en",
      maxResults: 2,
    });
    await geocoder.search("Stephansplatz 1");
    const url = new URL((fetchFn.mock.calls[0] as unknown as [string])[0]);
    expect(url.origin + url.pathname).toBe("http://photon.test:2322/api");
    expect(url.searchParams.get("limit")).toBe("2");
    expect(url.searchParams.get("lang")).toBe("en");
  });

  it("reverses with lat/lon and maps the first hit", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(fixture("photon-search-vienna.json")));
    const hit = await make(fetchFn as unknown as typeof fetch).reverse(48.2084639, 16.3720438);
    expect(hit).toMatchObject({ lat: 48.2084639, lng: 16.3720438, confidence: 1 });
    const url = new URL((fetchFn.mock.calls[0] as unknown as [string])[0]);
    expect(url.pathname).toBe("/reverse");
    expect(url.searchParams.get("lat")).toBe("48.2084639");
    expect(url.searchParams.get("lon")).toBe("16.3720438");
    expect(url.searchParams.get("limit")).toBe("1");
  });

  it("does not call the network for an empty address and validates input", async () => {
    const fetchFn = vi.fn();
    const geocoder = make(fetchFn as unknown as typeof fetch);
    expect(await geocoder.search("  ")).toEqual([]);
    await expect(geocoder.search("x".repeat(301))).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(geocoder.reverse(95, 0)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("turns a non-JSON answer and an HTTP error into a GeocoderError", async () => {
    const html = vi.fn(async () => new Response("<html>", { status: 200 }));
    await expect(make(html as unknown as typeof fetch).search("Wien")).rejects.toMatchObject({
      code: "BAD_RESPONSE",
    });
    const refused = vi.fn(async () => jsonResponse({ error: "busy" }, 400));
    await expect(make(refused as unknown as typeof fetch).search("Wien")).rejects.toMatchObject({
      code: "HTTP",
      status: 400,
    });
  });
});

describe("getGeocoder with PHOTON_URL", () => {
  afterEach(() => {
    setGeocoderForTests(undefined);
    vi.restoreAllMocks();
  });

  it("prefers the self-hosted Photon over the hosted ORS key", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(fixture("photon-search-vienna.json")));
    vi.stubGlobal("fetch", fetchFn);
    try {
      const geocoder = getGeocoder({
        PHOTON_URL: " http://127.0.0.1:2322/ ",
        ORS_API_KEY: "hosted-key",
      });
      await geocoder.search("Stephansplatz 1");
      const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
      expect(new URL(url).origin + new URL(url).pathname).toBe("http://127.0.0.1:2322/api");
      // A hosted key must not leak to a local instance that has none.
      expect(init.headers).toEqual({ Accept: "application/json" });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
