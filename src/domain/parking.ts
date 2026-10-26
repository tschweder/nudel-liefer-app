/**
 * Pure parking-spot rules (NUD-125, D22). A customer has a list of spots; the first active one by
 * `sortOrder` is the default and, from NUD-141 on, the routing and navigation point.
 */

export const PARKING_LABEL_MAX = 80;
export const PARKING_NOTE_MAX = 500;
/** Active spots per customer; more than a handful is a data-entry mistake, not a use case. */
export const PARKING_MAX_ACTIVE = 10;

export type ParkingSpotLike = { sortOrder: number; active: boolean };

/** Active spots in display order (stable for equal `sortOrder`). */
export function activeParkingSpots<T extends ParkingSpotLike>(spots: readonly T[]): T[] {
  return spots.filter((s) => s.active).sort((a, b) => a.sortOrder - b.sortOrder);
}

/** The default Parkplatz: the first active spot, or `null` when the customer has none. */
export function defaultParkingSpot<T extends ParkingSpotLike>(spots: readonly T[]): T | null {
  return activeParkingSpots(spots)[0] ?? null;
}

/** Moves the element at `from` to `to` (both inside the list); returns a new array. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return [...items];
  }
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as T);
  return next;
}
