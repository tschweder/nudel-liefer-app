/**
 * Spaces calls at least `intervalMs` apart (also across concurrent callers of the same instance):
 * every caller reserves the next free slot and sleeps until it. Used for geocoding batches so the
 * ORS free tier (about 100 requests / minute) is not exceeded. Clock and sleep are injectable.
 */
export function createThrottle(
  intervalMs: number,
  clock: () => number = Date.now,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
) {
  let next = 0;
  return async function waitTurn(): Promise<void> {
    if (intervalMs <= 0) return;
    const now = clock();
    const at = Math.max(now, next);
    next = at + intervalMs;
    if (at > now) await sleep(at - now);
  };
}
