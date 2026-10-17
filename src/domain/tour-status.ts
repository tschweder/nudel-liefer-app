/**
 * Tour status machine (NUD-043): DRAFT -> OPTIMIZED -> RELEASED -> IN_PROGRESS -> COMPLETED.
 * Pure rules, no framework imports. Stop statuses are `PENDING | DELIVERED | PROBLEM`; a stop
 * counts as done as soon as it is no longer PENDING.
 */

export const TOUR_STATUSES = [
  "DRAFT",
  "OPTIMIZED",
  "RELEASED",
  "IN_PROGRESS",
  "COMPLETED",
] as const;
export type TourStatusName = (typeof TOUR_STATUSES)[number];

/**
 * Allowed transitions. Staying in the same status is allowed where the same action can repeat:
 * rebuilding an OPTIMIZED tour, re-releasing a RELEASED / IN_PROGRESS tour after order changes,
 * and a further stop completing while the tour is IN_PROGRESS. COMPLETED is final.
 */
const TRANSITIONS: Record<TourStatusName, readonly TourStatusName[]> = {
  DRAFT: ["OPTIMIZED"],
  OPTIMIZED: ["OPTIMIZED", "RELEASED"],
  RELEASED: ["RELEASED", "IN_PROGRESS", "COMPLETED"],
  IN_PROGRESS: ["IN_PROGRESS", "COMPLETED"],
  COMPLETED: [],
};

export function isTourStatus(value: string): value is TourStatusName {
  return (TOUR_STATUSES as readonly string[]).includes(value);
}

export function canTransition(from: string, to: string): boolean {
  return isTourStatus(from) && isTourStatus(to) && TRANSITIONS[from].includes(to);
}

/** The driver has the tour (or had it): RELEASED, IN_PROGRESS, COMPLETED. */
export function isReleasedStatus(status: string): boolean {
  return status === "RELEASED" || status === "IN_PROGRESS" || status === "COMPLETED";
}

/** Tours that can be re-released after order changes: the driver has them and they are not finished. */
export function isReReleasable(status: string): boolean {
  return status === "RELEASED" || status === "IN_PROGRESS";
}

export function isStopDone(stopStatus: string): boolean {
  return stopStatus !== "PENDING";
}

/**
 * Status a released tour has given its stops: nothing done yet -> unchanged, some done ->
 * IN_PROGRESS (first stop completed), all done -> COMPLETED. Tours that are not released and
 * COMPLETED tours are returned unchanged; a tour never moves backwards.
 */
export function deriveTourStatus(current: string, stopStatuses: readonly string[]): TourStatusName {
  if (!isTourStatus(current)) throw new Error(`Unknown tour status "${current}"`);
  if (!isReReleasable(current)) return current;
  const done = stopStatuses.filter(isStopDone).length;
  if (stopStatuses.length > 0 && done === stopStatuses.length) return "COMPLETED";
  if (done > 0) return "IN_PROGRESS";
  return current;
}
