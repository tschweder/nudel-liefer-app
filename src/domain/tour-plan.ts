/**
 * Pure rules of the tour planning screen (NUD-042): which tours may still be edited, manual
 * reordering, and when a tour may be released. No framework imports.
 */

/** Tours the office may still change; RELEASED and later are the driver's (NUD-043 defines edits). */
export const EDITABLE_TOUR_STATUSES = ["DRAFT", "OPTIMIZED"] as const;

export function isTourEditable(status: string): boolean {
  return (EDITABLE_TOUR_STATUSES as readonly string[]).includes(status);
}

/** Copy of `list` with the item at `from` moved to index `to` (both clamped into range). */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  if (from < 0 || from >= next.length) return next;
  const target = Math.min(Math.max(to, 0), next.length - 1);
  const [item] = next.splice(from, 1);
  next.splice(target, 0, item);
  return next;
}

/** True when `requested` contains exactly the ids of `current`, each once (any order). */
export function isPermutation(current: readonly string[], requested: readonly string[]): boolean {
  if (current.length !== requested.length) return false;
  const wanted = new Set(requested);
  if (wanted.size !== requested.length) return false;
  return current.every((id) => wanted.has(id));
}

export function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

export type ReleaseBlocker =
  "tour_not_editable" | "no_stops" | "driver_required" | "vehicle_required" | "outdated";

/**
 * Why a tour cannot be released yet (first match), or `null`. A tour whose orders changed after it
 * was built (`isOutdated`) must be rebuilt first: the driver would see stale quantities.
 */
export function releaseBlocker(tour: {
  status: string;
  stopCount: number;
  driverId: string | null;
  /** NUD-146: a release needs a vehicle as well as a driver (D24). */
  vehicleId: string | null;
  isOutdated: boolean;
}): ReleaseBlocker | null {
  if (!isTourEditable(tour.status)) return "tour_not_editable";
  if (tour.stopCount === 0) return "no_stops";
  if (!tour.driverId) return "driver_required";
  if (!tour.vehicleId) return "vehicle_required";
  if (tour.isOutdated) return "outdated";
  return null;
}

/** Whole hours and remaining minutes (rounded up to full minutes) of a duration in seconds. */
export function durationParts(seconds: number): { hours: number; minutes: number } {
  const total = Math.max(0, Math.ceil(seconds / 60));
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}
