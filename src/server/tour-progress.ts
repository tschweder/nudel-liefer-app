import { pickDefaultTour } from "@/domain/day-tours";
import { parseCalendarDate } from "@/domain/order";
import { parsePollInterval, summarizeProgress, type TourProgress } from "@/domain/tour-progress";
import type { PrismaClient } from "@/generated/prisma/client";

import { requireRole } from "./auth/guards";
import { getDb } from "./db";
import { todayInTimezone } from "./driver-today";
import { getLateOrdersView } from "./late-orders";
import { getFactoryTimezone } from "./settings";

/** Read model of the admin dashboard card "Today" (NUD-054). */
export type TodayProgress = {
  /** `YYYY-MM-DD` in the factory time zone. */
  date: string;
  timezone: string;
  tour: {
    id: string;
    status: "DRAFT" | "OPTIMIZED" | "RELEASED" | "IN_PROGRESS" | "COMPLETED";
    driverName: string | null;
    progress: TourProgress;
    /** First open stop in tour order; `null` when nothing is open. */
    nextStop: {
      id: string;
      name: string;
      street: string;
      postalCode: string;
      city: string;
      etaAt: string | null;
    } | null;
    problemStops: Array<{ id: string; name: string; reason: string | null }>;
  } | null;
  /** Confirmed orders for today that arrived after today's tour was completed (NUD-099). */
  lateOrderCount: number;
};

type Db = Pick<PrismaClient, "tour" | "stop" | "order" | "customer" | "product">;

/** Today's tour (v1 has one; with a follow-up tour the one still open) with its progress, `tour: null` when none exists. */
export async function getTodayProgress(
  db: Db,
  options: { now: Date; timezone: string },
): Promise<TodayProgress> {
  const date = todayInTimezone(options.now, options.timezone);
  const day = parseCalendarDate(date);
  if (!day) throw new Error("Unreachable: todayInTimezone returns a valid date");
  // Several tours on the day (NUD-099): the one that still needs work, else the newest.
  const tour = pickDefaultTour(
    await db.tour.findMany({
      where: { date: day },
      include: {
        driver: { select: { displayName: true } },
        stops: {
          orderBy: { sequence: "asc" },
          include: {
            customer: { select: { name: true, street: true, postalCode: true, city: true } },
          },
        },
      },
    }),
  );
  if (!tour) return { date, timezone: options.timezone, tour: null, lateOrderCount: 0 };

  // Only a finished day can have late orders (an open tour picks new orders up by itself).
  const lateOrderCount =
    tour.status === "COMPLETED" ? (await getLateOrdersView(db, day)).lateOrderCount : 0;
  const progress = summarizeProgress(tour.stops);
  const next = tour.stops.find((s) => s.id === progress.nextStopId) ?? null;
  return {
    date,
    timezone: options.timezone,
    lateOrderCount,
    tour: {
      id: tour.id,
      status: tour.status,
      driverName: tour.driver?.displayName ?? null,
      progress,
      nextStop: next
        ? {
            id: next.id,
            name: next.customer.name,
            street: next.customer.street,
            postalCode: next.customer.postalCode,
            city: next.customer.city,
            etaAt: next.etaAt?.toISOString() ?? null,
          }
        : null,
      problemStops: tour.stops
        .filter((s) => s.status === "PROBLEM")
        .map((s) => ({ id: s.id, name: s.customer.name, reason: s.problemReason })),
    },
  };
}

/** Admin-only read for the dashboard; the role is checked before anything is read. */
export async function todayProgressQuery(now: Date = new Date()): Promise<TodayProgress> {
  await requireRole("ADMIN");
  return getTodayProgress(getDb(), { now, timezone: await getFactoryTimezone() });
}

/**
 * How often the admin screens re-read live progress (ms): `LIVE_POLL_INTERVAL_MS`, default 30 s.
 * A shorter value exists for the e2e tests; invalid values fall back to the default.
 */
export function getLivePollIntervalMs(): number {
  return parsePollInterval(process.env.LIVE_POLL_INTERVAL_MS);
}
