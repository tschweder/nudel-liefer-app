import { FallbackRoutingProvider } from "./fallback";
import { LocalHeuristicProvider } from "./heuristic";
import { DEFAULT_PROFILE, ORS_PROFILES, type OrsProfile, OrsRoutingProvider } from "./ors";
import type { RoutingProvider } from "./types";

export { FallbackRoutingProvider } from "./fallback";
export { LocalHeuristicProvider } from "./heuristic";
export {
  mapDirectionsResponse,
  mapFleetResponse,
  mapOptimizationResponse,
  OrsRoutingProvider,
} from "./ors";
export * from "./types";

let instance: RoutingProvider | undefined;
let warned = false;

/** `ORS_ROUTING_PROFILE`: `driving-car` (default) or `driving-hgv`; anything else falls back to the default. */
export function parseProfile(value: string | undefined): OrsProfile {
  const profile = value?.trim();
  if (!profile) return DEFAULT_PROFILE;
  if ((ORS_PROFILES as readonly string[]).includes(profile)) return profile as OrsProfile;
  console.warn(`[routing] unknown ORS_ROUTING_PROFILE "${profile}" - using ${DEFAULT_PROFILE}`);
  return DEFAULT_PROFILE;
}

/** Same trimming rule as the geocoder's `parseBaseUrl` (which reads its own variable, NUD-156). */
export function parseBaseUrl(value: string | undefined): string | undefined {
  const baseUrl = value?.trim().replace(/\/+$/, "");
  return baseUrl ? baseUrl : undefined;
}

/**
 * Routing provider selected from the environment: ORS with automatic fallback to the local
 * heuristic when either `ORS_API_KEY` (hosted API) or `ORS_BASE_URL` (self-hosted instance,
 * NUD-156 — it needs no key) is set, otherwise the heuristic alone and a single warning. Results
 * from the heuristic are always flagged `approximate: true`. `ORS_BASE_URL` points the
 * routing/optimization calls at a self-hosted openrouteservice; unset keeps the public API.
 * Geocoding has its own variable (`PHOTON_URL` / `ORS_GEOCODE_BASE_URL`), because the self-hosted
 * image does not serve `/geocode/*` at all.
 */
export function getRoutingProvider(
  env: Record<string, string | undefined> = process.env,
): RoutingProvider {
  if (instance) return instance;
  const apiKey = env.ORS_API_KEY?.trim() ?? "";
  const baseUrl = parseBaseUrl(env.ORS_BASE_URL);
  const heuristic = new LocalHeuristicProvider();
  if (apiKey || baseUrl) {
    instance = new FallbackRoutingProvider(
      new OrsRoutingProvider({
        apiKey,
        baseUrl,
        profile: parseProfile(env.ORS_ROUTING_PROFILE),
      }),
      heuristic,
    );
  } else {
    if (!warned) {
      warned = true;
      console.warn(
        "[routing] neither ORS_API_KEY nor ORS_BASE_URL is set - using the local heuristic (distances and times are estimates, approximate)",
      );
    }
    instance = heuristic;
  }
  return instance;
}

/** Test helper. */
export function setRoutingProviderForTests(provider: RoutingProvider | undefined) {
  instance = provider;
  if (!provider) warned = false;
}
