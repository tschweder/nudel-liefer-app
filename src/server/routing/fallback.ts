import type {
  OptimizeInput,
  OptimizeResult,
  RouteInput,
  RouteResult,
  RoutingProvider,
} from "./types";
import { RoutingError } from "./types";

/** Errors that mean "the caller's input is wrong": a fallback would not help, so they propagate. */
const NOT_FALLBACK = new Set(["INVALID_INPUT", "TOO_MANY_STOPS"]);

/**
 * Tries `primary`; when it fails (timeout, network, HTTP error, unusable response, no route) the
 * `fallback` answers instead, and its result carries `approximate: true`. Invalid input and
 * too many stops are not retried on the fallback.
 */
export class FallbackRoutingProvider implements RoutingProvider {
  constructor(
    private readonly primary: RoutingProvider,
    private readonly fallback: RoutingProvider,
    private readonly log: (message: string) => void = (m) => console.warn(m),
  ) {}

  optimize(input: OptimizeInput): Promise<OptimizeResult> {
    return this.run((p) => p.optimize(input), "optimize");
  }

  route(input: RouteInput): Promise<RouteResult> {
    return this.run((p) => p.route(input), "route");
  }

  private async run<T>(call: (p: RoutingProvider) => Promise<T>, name: string): Promise<T> {
    try {
      return await call(this.primary);
    } catch (error) {
      if (error instanceof RoutingError && NOT_FALLBACK.has(error.code)) throw error;
      const reason = error instanceof RoutingError ? error.code : "UNEXPECTED";
      this.log(`[routing] ${name} failed (${reason}) - using the local heuristic (approximate)`);
      return call(this.fallback);
    }
  }
}
