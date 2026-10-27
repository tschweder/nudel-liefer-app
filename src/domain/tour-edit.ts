/**
 * Pure rules of "Bearbeiten" (NUD-135, D29): which tours may be edited, and how the new stop order
 * of an edited tour is put together. No framework imports.
 *
 * D29: the office may change the driver, the stop order and move stops between tours of the same
 * date, also on released tours. Completed stops are locked (they keep their status, data and
 * their place in the sequence); a COMPLETED tour is history and not editable at all.
 */
import { isPermutation } from "./tour-plan";

/** Every tour that is not COMPLETED can be edited (unreleased: directly, released: via "tour updated"). */
export function canEditTour(status: string): boolean {
  return (
    status !== "COMPLETED" && ["DRAFT", "OPTIMIZED", "RELEASED", "IN_PROGRESS"].includes(status)
  );
}

export type EditStop = { id: string; status: string };

/** Only a stop nobody has worked on can be reordered or moved to another tour. */
export function isStopMovable(stop: EditStop): boolean {
  return stop.status === "PENDING";
}

/**
 * The stop ids of the edited tour in their new order. `current` is the tour as stored (by sequence),
 * `moved` the ids that leave for another tour, `orderedPendingIds` the requested order of the
 * pending stops that stay. Completed stops keep their slot in the list; the pending ones fill the
 * other slots in the requested order. `null` when `orderedPendingIds` is not exactly the set of the
 * pending stops that stay (the page is out of date).
 */
export function mergePendingOrder(
  current: readonly EditStop[],
  moved: ReadonlySet<string>,
  orderedPendingIds: readonly string[],
): string[] | null {
  const staying = current.filter((s) => !moved.has(s.id));
  const pendingIds = staying.filter(isStopMovable).map((s) => s.id);
  if (!isPermutation(pendingIds, orderedPendingIds)) return null;
  let next = 0;
  return staying.map((s) => (isStopMovable(s) ? orderedPendingIds[next++] : s.id));
}
