import { z } from "zod";

import {
  type GeocodeCandidate,
  type Geocoder,
  GeocoderError,
  MAX_ADDRESS_LENGTH,
  normalizeAddress,
} from "./types";

export const ORS_DEFAULT_BASE_URL = "https://api.openrouteservice.org";
export const DEFAULT_COUNTRIES = ["AT", "DE"];

const featureCollection = z.object({
  features: z.array(
    z.object({
      geometry: z.object({
        type: z.literal("Point"),
        coordinates: z.tuple([z.number(), z.number()]).rest(z.number()),
      }),
      properties: z.object({ label: z.string(), confidence: z.number().min(0).max(1).optional() }),
    }),
  ),
});

/** Maps an ORS (Pelias) GeoJSON response to candidates. Throws `GeocoderError` on a bad shape. */
export function mapOrsResponse(body: unknown): GeocodeCandidate[] {
  const parsed = featureCollection.safeParse(body);
  if (!parsed.success) {
    throw new GeocoderError("Unexpected response from the geocoding service", "BAD_RESPONSE");
  }
  return parsed.data.features.map((f) => ({
    label: f.properties.label,
    // GeoJSON order is [lon, lat].
    lng: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
    confidence: f.properties.confidence ?? 0,
  }));
}

export type OrsGeocoderOptions = {
  apiKey: string;
  baseUrl?: string;
  /** ISO 3166-1 alpha-2 codes for `boundary.country`. Default AT, DE. */
  countries?: string[];
  timeoutMs?: number;
  /** Extra attempts after a timeout, network error or 5xx/429. Default 1. */
  retries?: number;
  maxResults?: number;
  fetch?: typeof fetch;
};

/** OpenRouteService geocoding (`/geocode/search`, `/geocode/reverse`). */
export class OrsGeocoder implements Geocoder {
  private readonly baseUrl: string;
  private readonly countries: string[];
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly maxResults: number;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: OrsGeocoderOptions) {
    this.baseUrl = (options.baseUrl ?? ORS_DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.countries = options.countries?.length ? options.countries : DEFAULT_COUNTRIES;
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.retries = options.retries ?? 1;
    this.maxResults = options.maxResults ?? 5;
    this.fetchFn = options.fetch ?? fetch;
  }

  async search(address: string): Promise<GeocodeCandidate[]> {
    const text = address.trim().replace(/\s+/g, " ");
    if (!normalizeAddress(text)) return [];
    if (text.length > MAX_ADDRESS_LENGTH) {
      throw new GeocoderError("Address is too long", "INVALID_INPUT");
    }
    const params = new URLSearchParams({
      text,
      "boundary.country": this.countries.join(","),
      size: String(this.maxResults),
    });
    return mapOrsResponse(await this.get(`/geocode/search?${params}`));
  }

  async reverse(lat: number, lng: number): Promise<GeocodeCandidate | null> {
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180
    ) {
      throw new GeocoderError("Invalid coordinates", "INVALID_INPUT");
    }
    const params = new URLSearchParams({
      "point.lat": String(lat),
      "point.lon": String(lng),
      size: "1",
    });
    return mapOrsResponse(await this.get(`/geocode/reverse?${params}`))[0] ?? null;
  }

  private async get(path: string): Promise<unknown> {
    let lastError: GeocoderError | undefined;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      let response: Response;
      try {
        response = await this.fetchFn(`${this.baseUrl}${path}`, {
          headers: { Authorization: this.options.apiKey, Accept: "application/json" },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error) {
        const timedOut =
          error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        lastError = timedOut
          ? new GeocoderError("Geocoding service timed out", "TIMEOUT")
          : new GeocoderError("Geocoding service is unreachable", "NETWORK");
        continue;
      }
      if (response.ok) {
        try {
          return await response.json();
        } catch {
          throw new GeocoderError("Response was not JSON", "BAD_RESPONSE");
        }
      }
      lastError = new GeocoderError(
        `Geocoding service answered HTTP ${response.status}`,
        "HTTP",
        response.status,
      );
      // 4xx (bad key, quota, bad request) will not get better by retrying; 429/5xx might.
      if (response.status < 500 && response.status !== 429) throw lastError;
    }
    throw lastError ?? new GeocoderError("Geocoding failed", "NETWORK");
  }
}
