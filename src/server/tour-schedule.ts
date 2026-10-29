import { computeSchedule, departureInstant } from "@/domain/tour";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Re-anchoring the plan to reality (NUD-172, QA 2026-10-29 F3).
 *
 * `Stop.etaAt` is written once when the tour is optimised, anchored to `Settings.departureTime` on
 * the tour's date. A tour that is released at 11:44 therefore shows arrival times of 06:47 for the
 * rest of the day, and the same screen carries a second, different "end of tour" number.
 *
 * This module owns the ONE rule that fixes that: the arrival times of the still-open stops are
 * recomputed from a real anchor — the release (when the planned start is already past), the
 * driver's departure and every completed stop — and written back to the same column every screen
 * reads. Completed stops keep the ETA they had when the driver worked them (history).
 *
 * Both call sites run inside the existing per-date advisory lock of the stop-status/release
 * transactions, so a rebase never races a status change.
 */

type Tx = Prisma.TransactionClient;

async function serviceSecondsPerStop(tx: Tx): Promise<number> {
  const settings = await tx.settings.findFirst({ select: { serviceMinutesPerStop: true } });
  return (settings?.serviceMinutesPerStop ?? 0) * 60;
}

/**
 * Recompute the ETAs of every PENDING stop of a released tour, starting at `anchor`.
 * The legs of the open stops are used as they are stored (leg from the previous point to the stop),
 * so the first open stop is reached from wherever the driver just was.
 */
export async function rebaseTourSchedule(tx: Tx, tourId: string, anchor: Date): Promise<void> {
  const tour = await tx.tour.findUnique({
    where: { id: tourId },
    select: {
      status: true,
      stops: {
        orderBy: { sequence: "asc" },
        select: { id: true, status: true, legDurationS: true },
      },
    },
  });
  if (!tour) return;
  // Only a tour the driver can see carries meaningful arrival times.
  if (tour.status !== "RELEASED" && tour.status !== "IN_PROGRESS") return;
  const open = tour.stops.filter((stop) => stop.status === "PENDING");
  if (open.length === 0) return;

  const schedule = computeSchedule({
    departure: anchor,
    legDurationsS: [...open.map((stop) => stop.legDurationS ?? 0), 0],
    serviceSecondsPerStop: await serviceSecondsPerStop(tx),
  });

  for (const [index, stop] of open.entries()) {
    const etaAt = schedule.etas[index];
    if (!etaAt) continue;
    await tx.stop.update({ where: { id: stop.id }, data: { etaAt } });
  }
}

/**
 * Release / re-release hook: re-anchor the plan to reality when the planned start is already past.
 * - The driver already left (`departedAt`): his departure is the anchor, a re-release must not push
 *   him back to 06:30.
 * - Otherwise, if the planned start is in the past, the anchor is "now plus the loading time".
 * - A plan that still starts in the future is left alone — it is not wrong yet.
 */
export async function rebaseOnRelease(tx: Tx, tourId: string, now: Date): Promise<void> {
  const tour = await tx.tour.findUnique({
    where: { id: tourId },
    select: { date: true, departedAt: true },
  });
  if (!tour) return;
  if (tour.departedAt) {
    await rebaseTourSchedule(tx, tourId, tour.departedAt);
    return;
  }
  const settings = await tx.settings.findFirst({
    select: { timezone: true, departureTime: true, defaultLoadingMinutes: true },
  });
  if (!settings) return;
  const plannedStart = departureInstant(tour.date, settings.departureTime, settings.timezone);
  if (plannedStart.getTime() >= now.getTime()) return;
  const loadingMs = Math.max(settings.defaultLoadingMinutes, 0) * 60_000;
  await rebaseTourSchedule(tx, tourId, new Date(now.getTime() + loadingMs));
}
