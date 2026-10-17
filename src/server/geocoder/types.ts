export type GeocodeCandidate = {
  /** Human readable address label as returned by the provider (not translated). */
  label: string;
  lat: number;
  lng: number;
  /** 0..1, how sure the provider is that this is the requested place. */
  confidence: number;
};

/**
 * Turns addresses into candidate coordinates (and back, for pin drag feedback).
 * Implementations: OpenRouteService (`OrsGeocoder`) and a deterministic `FakeGeocoder`.
 * The admin always confirms the final pin (D9); a geocoder only proposes.
 */
export interface Geocoder {
  /** Candidates for a free-text address, best first. Empty array when nothing was found. */
  search(address: string): Promise<GeocodeCandidate[]>;
  /** Nearest address for a coordinate, or `null` when none is known. */
  reverse(lat: number, lng: number): Promise<GeocodeCandidate | null>;
}

export class GeocoderError extends Error {
  constructor(
    message: string,
    readonly code: "TIMEOUT" | "NETWORK" | "HTTP" | "BAD_RESPONSE" | "INVALID_INPUT",
    readonly status?: number,
  ) {
    super(message);
    this.name = "GeocoderError";
  }
}

export const MAX_ADDRESS_LENGTH = 300;

/** Lower-case, trimmed, single-spaced: the cache key and the Fake's hash input. */
export function normalizeAddress(address: string): string {
  return address.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}
