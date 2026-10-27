import { z } from "zod";

import {
  type GeocodeCandidate,
  type Geocoder,
  GeocoderError,
  MAX_ADDRESS_LENGTH,
  normalizeAddress,
} from "./types";

/**
 * Komoot **Photon** (`https://photon.komoot.io`) - the self-hosted geocoder for the customer master
 * data (NUD-157). It is a *different service* from openrouteservice: the self-hosted ORS image has
 * no `/geocode/*` endpoint at all, so there is no way to geocode from an ORS instance.
 *
 * API shape differs from ORS/Pelias as well (this is why it is its own class and not just a URL):
 *   GET /api?q=<address>&limit=5&lang=de   -> GeoJSON FeatureCollection, [lon, lat]
 *   GET /reverse?lat=..&lon=..&limit=1&lang=de
 * Photon has no `label` field, so the label is assembled from the address parts, and no confidence,
 * so the hit granularity (`properties.type`) is mapped to one.
 */
export const PHOTON_DEFAULT_BASE_URL = "http://127.0.0.1:2322";
/** Photon answers one language per request; Austrian addresses are German-first. */
export const PHOTON_DEFAULT_LANG = "de";

const feature = z.object({
  geometry: z.object({
    type: z.literal("Point"),
    coordinates: z.tuple([z.number(), z.number()]).rest(z.number()),
  }),
  properties: z
    .object({
      name: z.string().optional(),
      housenumber: z.string().optional(),
      street: z.string().optional(),
      postcode: z.string().optional(),
      city: z.string().optional(),
      district: z.string().optional(),
      state: z.string().optional(),
      country: z.string().optional(),
      /** `house`, `street`, `city`, `district`, `locality`, `other`, ... */
      type: z.string().optional(),
      /** Older Photon builds send it, current ones do not. */
      confidence: z.number().min(0).max(1).optional(),
    })
    .default({}),
});

const featureCollection = z.object({ features: z.array(feature) });

/** Hit granularity -> confidence, for responses that carry no `confidence` of their own. */
function confidenceForType(type: string | undefined): number {
  switch (type) {
    case "house":
      return 1;
    case "street":
      return 0.8;
    case "city":
    case "district":
    case "locality":
    case "postcode":
      return 0.5;
    default:
      return 0;
  }
}

/** "Stephansplatz 1, 1010 Wien, Österreich" from the parts Photon actually filled. */
function labelFrom(properties: z.infer<typeof feature>["properties"]): string {
  const street = [properties.street, properties.housenumber].filter(Boolean).join(" ");
  const place = [properties.postcode, properties.city].filter(Boolean).join(" ");
  const parts = [properties.name, street, place, properties.country].filter(
    (part): part is string => Boolean(part && part.trim()),
  );
  // A hit without street, city or name still has to be labelled with something.
  return parts.length ? [...new Set(parts)].join(", ") : "Unbekannte Adresse";
}

/** Maps a Photon GeoJSON body to candidates. Throws `GeocoderError` on an unexpected shape. */
export function mapPhotonResponse(body: unknown): GeocodeCandidate[] {
  const parsed = featureCollection.safeParse(body);
  if (!parsed.success) {
    throw new GeocoderError("Unexpected response from the geocoding service", "BAD_RESPONSE");
  }
  return parsed.data.features.map((f) => ({
    label: labelFrom(f.properties),
    // GeoJSON order is [lon, lat].
    lng: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
    confidence: f.properties.confidence ?? confidenceForType(f.properties.type),
  }));
}

export type PhotonGeocoderOptions = {
  baseUrl?: string;
  /** Language of the returned labels, `de` by default. */
  lang?: string;
  timeoutMs?: number;
  /** Extra attempts after a timeout, network error or 5xx/429. Default 1. */
  retries?: number;
  maxResults?: number;
  fetch?: typeof fetch;
};

/** Komoot Photon geocoding (`/api`, `/reverse`). No API key: a self-hosted instance has none. */
export class PhotonGeocoder implements Geocoder {
  private readonly baseUrl: string;
  private readonly lang: string;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly maxResults: number;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: PhotonGeocoderOptions = {}) {
    this.baseUrl = (options.baseUrl ?? PHOTON_DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.lang = options.lang ?? PHOTON_DEFAULT_LANG;
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
      q: text,
      limit: String(this.maxResults),
      lang: this.lang,
    });
    return mapPhotonResponse(await this.get(`/api?${params}`));
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
      lat: String(lat),
      lon: String(lng),
      limit: "1",
      lang: this.lang,
    });
    return mapPhotonResponse(await this.get(`/reverse?${params}`))[0] ?? null;
  }

  private async get(path: string): Promise<unknown> {
    let lastError: GeocoderError | undefined;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      let response: Response;
      try {
        response = await this.fetchFn(`${this.baseUrl}${path}`, {
          headers: { Accept: "application/json" },
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
      // 4xx (bad request, quota) will not get better by retrying; 429/5xx might.
      if (response.status < 500 && response.status !== 429) throw lastError;
    }
    throw lastError ?? new GeocoderError("Geocoding failed", "NETWORK");
  }
}
