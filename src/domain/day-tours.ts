/**
 * Several tours on one delivery day (NUD-099). D5: v1 plans one tour per day, but `Tour.date` has no
 * unique constraint. A day gets a second tour (a "follow-up tour") when confirmed orders arrive
 * after the tour of that day is COMPLETED. Pure selection rules, no framework imports.
 */
import type { StopOrderInput } from "./tour";
import { type ItemChange, planReRelease, type SnapshotStop } from "./tour-diff";

export type DayTour = { id: string; status: string; createdAt: Date | string | number };

function time(value: DayTour["createdAt"]): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

/** Creation order, oldest first (ties by id): the numbering "Tour 1", "Tour 2" of the tabs. */
export function sortDayTours<T extends DayTour>(tours: readonly T[]): T[] {
  return [...tours].sort(
    (a, b) => time(a.createdAt) - time(b.createdAt) || a.id.localeCompare(b.id),
  );
}

/** Newest first: the order in which "the latest tour" is looked up. */
function newestFirst<T extends DayTour>(tours: readonly T[]): T[] {
  return sortDayTours(tours).reverse();
}

/** A tour that still needs work: anything but COMPLETED (history). */
export function isOpenTour(status: string): boolean {
  return status !== "COMPLETED";
}

/**
 * The tour the planning screen and the dashboard show for a day: the newest tour that is not
 * completed, else the newest one; `null` for a day without tours. With one tour per day this is
 * that tour.
 */
export function pickDefaultTour<T extends DayTour>(tours: readonly T[]): T | null {
  const newest = newestFirst(tours);
  return newest.find((t) => isOpenTour(t.status)) ?? newest[0] ?? null;
}

/**
 * The tour a driver works on among his released tours of the day: the newest RELEASED /
 * IN_PROGRESS one, so a follow-up tour wins over the completed one before it; otherwise the newest
 * COMPLETED one (the "tour finished" screen). Unreleased tours are never visible.
 */
export function pickDriverTour<T extends DayTour>(tours: readonly T[]): T | null {
  const newest = newestFirst(tours);
  return (
    newest.find((t) => t.status === "RELEASED" || t.status === "IN_PROGRESS") ??
    newest.find((t) => t.status === "COMPLETED") ??
    null
  );
}

/**
 * Late orders: CONFIRMED orders of a day that no stop of any of its tours contains, while every
 * tour of the day is COMPLETED. Nothing will pick them up by itself: a completed tour is never
 * flagged outdated or re-released. With an open tour in the picture the ordinary outdated flag and
 * (re-)release handle new orders, so this returns nothing then, and for a day without tours.
 */
export function findLateOrderIds(
  tours: ReadonlyArray<{ status: string }>,
  orders: ReadonlyArray<{ id: string; linkedToTour: boolean }>,
): string[] {
  if (tours.length === 0 || tours.some((t) => isOpenTour(t.status))) return [];
  return orders.filter((o) => !o.linkedToTour).map((o) => o.id);
}

/** A follow-up tour may be created for a day whose tours are all COMPLETED and that has late orders. */
export function canCreateFollowUp(
  tours: ReadonlyArray<{ status: string }>,
  lateOrderCount: number,
): boolean {
  return tours.length > 0 && tours.every((t) => !isOpenTour(t.status)) && lateOrderCount > 0;
}

export type DeliveredStopConflict = {
  stopId: string;
  customerId: string;
  items: ItemChange[];
};

/**
 * Stops of completed tours whose linked orders were edited or cancelled after the tour ran
 * (quantity before = what the driver was given, after = the confirmed orders now). Such a change
 * cannot be delivered by a follow-up tour (the goods were delivered / the stop is closed), so it is
 * only reported to the office. `orders` are the CONFIRMED orders of the day.
 */
export function deliveredStopConflicts(
  stops: ReadonlyArray<Omit<SnapshotStop, "completed" | "sequence"> & { sequence?: number }>,
  orders: readonly StopOrderInput[],
): DeliveredStopConflict[] {
  return planReRelease(
    stops.map((s, index) => ({ ...s, sequence: s.sequence ?? index + 1, completed: true })),
    orders,
  ).diff.completedChanged;
}
