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

/** Same rule as the geocoder: trailing slashes are dropped, a blank value means "unset" (NUD-156). */
export function parseBaseUrl(value: string | undefined): string | undefined {
  const baseUrl = value?.trim().replace(/\/+$/, "");
  return baseUrl ? baseUrl : undefined;
}

/**
 * Routing provider selected from the environment: ORS with automatic fallback to the local
 * heuristic when `ORS_API_KEY` is set, otherwise the heuristic alone and a single warning. Results
 * from the heuristic are always flagged `approximate: true`. `ORS_BASE_URL` points at a
 * self-hosted ORS (NUD-156); unset keeps the public API.
 */
export function getRoutingProvider(
  env: Record<string, string | undefined> = process.env,
): RoutingProvider {
  if (instance) return instance;
  const apiKey = env.ORS_API_KEY?.trim();
  const heuristic = new LocalHeuristicProvider();
  if (apiKey) {
    instance = new FallbackRoutingProvider(
      new OrsRoutingProvider({
        apiKey,
        baseUrl: parseBaseUrl(env.ORS_BASE_URL),
        profile: parseProfile(env.ORS_ROUTING_PROFILE),
      }),
      heuristic,
    );
  } else {
    if (!warned) {
      warned = true;
      console.warn(
        "[routing] ORS_API_KEY not set - using the local heuristic (distances and times are estimates, approximate)",
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
