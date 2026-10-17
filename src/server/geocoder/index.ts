import { CachingGeocoder } from "./cache";
import { FakeGeocoder } from "./fake";
import { DEFAULT_COUNTRIES, OrsGeocoder } from "./ors";
import type { Geocoder } from "./types";

export { CachingGeocoder, LruCache } from "./cache";
export { FakeGeocoder } from "./fake";
export { mapOrsResponse, OrsGeocoder } from "./ors";
export * from "./types";

let instance: Geocoder | undefined;
let warned = false;

/** `ORS_GEOCODE_COUNTRIES="AT,DE"` -> `["AT","DE"]`; invalid entries are ignored. */
export function parseCountries(value: string | undefined): string[] {
  const list = (value ?? "")
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter((c) => /^[A-Z]{2}$/.test(c));
  return list.length ? list : DEFAULT_COUNTRIES;
}

/**
 * Geocoder selected from the environment: ORS (behind an LRU cache) when `ORS_API_KEY` is set,
 * otherwise the deterministic Fake and a single warning. The admin confirms every pin (D9), so
 * the Fake never silently becomes a delivery position.
 */
export function getGeocoder(env: Record<string, string | undefined> = process.env): Geocoder {
  if (instance) return instance;
  const apiKey = env.ORS_API_KEY?.trim();
  if (apiKey) {
    instance = new CachingGeocoder(
      new OrsGeocoder({ apiKey, countries: parseCountries(env.ORS_GEOCODE_COUNTRIES) }),
    );
  } else {
    if (!warned) {
      warned = true;
      console.warn(
        "[geocoder] ORS_API_KEY not set - using the FakeGeocoder (coordinates are NOT real addresses)",
      );
    }
    instance = new CachingGeocoder(new FakeGeocoder());
  }
  return instance;
}

/** Test helper. */
export function setGeocoderForTests(geocoder: Geocoder | undefined) {
  instance = geocoder;
  if (!geocoder) warned = false;
}
