import { type GeocodeCandidate, type Geocoder, normalizeAddress } from "./types";

/** Centre of Vienna; Fake coordinates are spread around it. */
const CENTER = { lat: 48.2082, lng: 16.3738 };
const SPREAD = { lat: 0.08, lng: 0.12 };

/** FNV-1a 32 bit. */
function fnv1a(input: string, seed = 0x811c9dc5): number {
  let hash = seed;
  for (const byte of new TextEncoder().encode(input)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

const round6 = (value: number) => Math.round(value * 1e6) / 1e6;

/**
 * Deterministic geocoder for tests and for runs without `ORS_API_KEY`: the same (normalized)
 * address always yields the same point inside a ~10 km box around Vienna. The confidence is low
 * on purpose so nobody mistakes these for real positions.
 */
export class FakeGeocoder implements Geocoder {
  async search(address: string): Promise<GeocodeCandidate[]> {
    const normalized = normalizeAddress(address);
    if (!normalized) return [];
    const u = fnv1a(normalized) / 0xffffffff;
    const v = fnv1a(normalized, 0x9747b28c) / 0xffffffff;
    return [
      {
        label: address.trim().replace(/\s+/g, " "),
        lat: round6(CENTER.lat + (u - 0.5) * 2 * SPREAD.lat),
        lng: round6(CENTER.lng + (v - 0.5) * 2 * SPREAD.lng),
        confidence: 0.3,
      },
    ];
  }

  async reverse(lat: number, lng: number): Promise<GeocodeCandidate | null> {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return {
      label: `${lat.toFixed(5)}, ${lng.toFixed(5)} (fake)`,
      lat,
      lng,
      confidence: 0.3,
    };
  }
}
