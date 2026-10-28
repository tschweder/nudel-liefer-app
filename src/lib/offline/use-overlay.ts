import { useMemo } from "react";

import type { SyncStopState } from "@/domain/driver-sync";

import { type OutboxEntry, overlayStops, type StopStatus, withServerSpots } from "./outbox";
import { useOutbox } from "./outbox-browser";

type StopLike = {
  id: string;
  status: StopStatus;
  problemReason: string | null;
  completedAt: string | null;
};

/** Settled server states first (until the page data catches up), the queued taps on top. */
function withOverlay<T extends StopLike>(
  stops: readonly T[],
  confirmed: Readonly<Record<string, SyncStopState>>,
  entries: readonly OutboxEntry[],
): readonly T[] {
  const base = stops.some((s) => confirmed[s.id])
    ? stops.map((s) => {
        const c = confirmed[s.id];
        return c
          ? {
              ...s,
              status: c.status,
              problemReason: c.problemReason,
              completedAt: c.completedAt,
              ...(c.hasKey !== undefined ? { hasKey: c.hasKey } : {}),
              ...(c.keyNumber !== undefined ? { keyNumber: c.keyNumber } : {}),
              ...(c.abbreviation !== undefined ? { abbreviation: c.abbreviation } : {}),
              ...withServerSpots(c),
            }
          : s;
      })
    : stops;
  return overlayStops(base, entries);
}

/**
 * The stops as the driver should see them: what the page was rendered with, plus the queued taps
 * that the server has not confirmed yet (NUD-082, optimistic UI). Identical to `stops` while the
 * queue is empty.
 */
export function useOverlaidStops<T extends StopLike>(stops: readonly T[]): readonly T[] {
  const { entries, confirmed } = useOutbox();
  return useMemo(() => withOverlay(stops, confirmed, entries), [stops, confirmed, entries]);
}

/** `useOverlaidStops` for a single stop. */
export function useOverlaidStop<T extends StopLike>(stop: T): T {
  const { entries, confirmed } = useOutbox();
  return useMemo(() => withOverlay([stop], confirmed, entries)[0]!, [stop, confirmed, entries]);
}
