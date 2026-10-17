/**
 * Live progress of a released tour (NUD-054): pure rules for the admin dashboard card and the
 * tour page. A stop is done as soon as it is not PENDING (DELIVERED or PROBLEM, see `tour-status`).
 */

export type ProgressStop = { id: string; sequence: number; status: string };

export type TourProgress = {
  total: number;
  delivered: number;
  problems: number;
  /** DELIVERED + PROBLEM. */
  done: number;
  pending: number;
  /** Whole percent of done stops (0 for an empty tour). */
  percent: number;
  /** First PENDING stop in tour order, `null` when nothing is open. */
  nextStopId: string | null;
};

export function summarizeProgress(stops: readonly ProgressStop[]): TourProgress {
  const delivered = stops.filter((s) => s.status === "DELIVERED").length;
  const problems = stops.filter((s) => s.status === "PROBLEM").length;
  const done = delivered + problems;
  const next = stops
    .filter((s) => s.status === "PENDING")
    .reduce<ProgressStop | null>((a, s) => (a === null || s.sequence < a.sequence ? s : a), null);
  return {
    total: stops.length,
    delivered,
    problems,
    done,
    pending: stops.length - done,
    percent: stops.length === 0 ? 0 : Math.round((done / stops.length) * 100),
    nextStopId: next?.id ?? null,
  };
}

/** Tours whose progress the office watches live: handed to the driver and not finished. */
export function isLiveStatus(status: string): boolean {
  return status === "RELEASED" || status === "IN_PROGRESS";
}

/** Tours that show the status view (stop results, coloured markers). */
export function showsStopResults(status: string): boolean {
  return status === "RELEASED" || status === "IN_PROGRESS" || status === "COMPLETED";
}

export const DEFAULT_POLL_INTERVAL_MS = 30_000;
const MIN_POLL_INTERVAL_MS = 1_000;
const MAX_POLL_INTERVAL_MS = 5 * 60_000;

/**
 * Poll interval from `LIVE_POLL_INTERVAL_MS` (milliseconds). Missing, non-numeric or out-of-range
 * values fall back to 30 s (the product default, D-NUD-054); the allowed range is 1 s to 5 min.
 */
export function parsePollInterval(raw: string | undefined): number {
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return DEFAULT_POLL_INTERVAL_MS;
  const value = Number(raw.trim());
  return value >= MIN_POLL_INTERVAL_MS && value <= MAX_POLL_INTERVAL_MS
    ? value
    : DEFAULT_POLL_INTERVAL_MS;
}
