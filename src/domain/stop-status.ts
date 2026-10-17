/** Pure rules of the driver's stop status (NUD-053): reasons, undo window, auto-advance. */

export const PROBLEM_REASONS = [
  "CLOSED",
  "NOBODY_THERE",
  "NO_PARKING",
  "WRONG_QUANTITY",
  "REFUSED",
  "ADDRESS_NOT_FOUND",
  "OTHER",
] as const;
export type ProblemReasonName = (typeof PROBLEM_REASONS)[number];

/** A completed stop can be reopened for this long (enforced on the server). */
export const UNDO_WINDOW_MS = 5 * 60 * 1000;

/** Maximum length of the optional free text of a problem report. */
export const PROBLEM_NOTE_MAX = 500;

/** When the undo window of a stop completed at `completedAt` ends. */
export function undoDeadline(completedAt: Date): Date {
  return new Date(completedAt.getTime() + UNDO_WINDOW_MS);
}

/** True while a stop completed at `completedAt` may still be undone at `now`. */
export function isWithinUndoWindow(completedAt: Date, now: Date): boolean {
  return now.getTime() <= undoDeadline(completedAt).getTime();
}

type StopLike = { id: string; sequence: number; status: string };

/**
 * The stop to open after `currentId` was completed (or undone): the next PENDING stop in tour
 * order after it; if there is none behind it, the first PENDING stop in front of it; `null` when
 * nothing is pending any more (the tour is finished).
 */
export function nextPendingAfter<T extends StopLike>(
  stops: readonly T[],
  currentId: string,
): T | null {
  const ordered = [...stops].sort((a, b) => a.sequence - b.sequence);
  const index = ordered.findIndex((s) => s.id === currentId);
  const pending = (s: T) => s.status === "PENDING" && s.id !== currentId;
  return (
    ordered.slice(index + 1).find(pending) ??
    ordered.slice(0, Math.max(index, 0)).find(pending) ??
    null
  );
}
