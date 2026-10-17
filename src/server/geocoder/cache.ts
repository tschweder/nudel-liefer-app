import { type GeocodeCandidate, type Geocoder, normalizeAddress } from "./types";

/** Minimal LRU on top of Map insertion order. */
export class LruCache<V> {
  private readonly map = new Map<string, V>();
  constructor(private readonly maxEntries: number) {}

  get(key: string): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: string, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }

  get size(): number {
    return this.map.size;
  }
}

/**
 * In-memory LRU in front of a geocoder so the same normalized address is not looked up twice
 * per server instance. Failures are never cached. Serverless instances do not share the cache;
 * that is accepted for 50-150 customers (see decision log).
 */
export class CachingGeocoder implements Geocoder {
  private readonly searches: LruCache<GeocodeCandidate[]>;
  private readonly reverses: LruCache<GeocodeCandidate | null>;

  constructor(
    private readonly inner: Geocoder,
    maxEntries = 500,
  ) {
    this.searches = new LruCache(maxEntries);
    this.reverses = new LruCache(maxEntries);
  }

  async search(address: string): Promise<GeocodeCandidate[]> {
    const key = normalizeAddress(address);
    const hit = this.searches.get(key);
    if (hit) return hit.map((c) => ({ ...c }));
    const result = await this.inner.search(address);
    this.searches.set(key, result);
    return result.map((c) => ({ ...c }));
  }

  async reverse(lat: number, lng: number): Promise<GeocodeCandidate | null> {
    // ~1 m resolution: dragging a pin by a few pixels should not trigger new calls.
    const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
    const hit = this.reverses.get(key);
    if (hit !== undefined) return hit ? { ...hit } : null;
    const result = await this.inner.reverse(lat, lng);
    this.reverses.set(key, result);
    return result ? { ...result } : null;
  }
}
