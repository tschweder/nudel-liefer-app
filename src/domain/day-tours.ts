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
 * The tours a driver sees on his home screen, oldest first (NUD-163). A day can have several tours
 * of one driver that still need work (D29 "+ Tour", D31 reloads); the driver must reach the pending
 * stops of *all* of them, so `pickDriverTour` (which returns one) is not enough. Pass the driver's
 * released tours of the day: every open one is listed — usually exactly one — and once they are all
 * COMPLETED only the newest one is left (the "tour finished" screen). The last element is the active
 * tour, i.e. what `pickDriverTour` returns, so callers that need one tour take that.
 */
export function driverDayTours<T extends DayTour>(tours: readonly T[]): T[] {
  const ordered = sortDayTours(tours);
  const open = ordered.filter((t) => isOpenTour(t.status));
  if (open.length > 0) return open;
  const newest = ordered.at(-1);
  return newest ? [newest] : [];
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

/** Whole-number quantity of one product that still has to be delivered (NUD-117). */
export type CorrectionLine = { productId: string; quantity: number };

/** A delivered stop whose order was increased: the difference can be delivered again (NUD-117). */
export type CorrectionCandidate = {
  /** The DELIVERED stop the difference belongs to. */
  stopId: string;
  customerId: string;
  /** Only the increases: delivered quantity plus this is the order now. */
  items: CorrectionLine[];
};

/**
 * Which delivered-stop conflicts the office can still deliver (NUD-117). The goods of a completed
 * stop cannot be taken back and the stop is never reset (NUD-043), so only an INCREASE can be
 * delivered afterwards — as a follow-up delivery for exactly the difference. A decrease or a
 * cancelled order stays a note (`deliveredStopConflicts`).
 *
 * A conflict is only offered while the difference is demonstrably not planned yet, so one click
 * cannot book the same goods twice:
 * - the customer must have no other stop on that day (`dayStops` = every stop of the day, with its
 *   id), because a second stop would already carry the difference, and
 * - none of the customer's CONFIRMED orders of the day may be on no stop yet (`orders` with
 *   `linkedToStop`), because such an order still waits for a tour and is planned first.
 * Both are the same test once the office worked the day off: as soon as the difference sits on a
 * stop, the conflict is still reported but no correction is offered any more.
 */
export function correctionCandidates(
  conflicts: readonly DeliveredStopConflict[],
  dayStops: ReadonlyArray<{ id: string; customerId: string }>,
  orders: ReadonlyArray<{ customerId: string; linkedToStop: boolean }>,
): CorrectionCandidate[] {
  const candidates: CorrectionCandidate[] = [];
  for (const conflict of conflicts) {
    const items = conflict.items
      .filter((item) => item.after > item.before)
      .map((item) => ({ productId: item.productId, quantity: item.after - item.before }));
    if (items.length === 0) continue;
    const hasAnotherStop = dayStops.some(
      (stop) => stop.customerId === conflict.customerId && stop.id !== conflict.stopId,
    );
    if (hasAnotherStop) continue;
    const waiting = orders.some(
      (order) => order.customerId === conflict.customerId && !order.linkedToStop,
    );
    if (waiting) continue;
    candidates.push({ stopId: conflict.stopId, customerId: conflict.customerId, items });
  }
  return candidates;
}
