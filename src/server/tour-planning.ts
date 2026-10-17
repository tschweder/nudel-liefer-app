import { z } from "zod";

import { formatCalendarDate, parseCalendarDate } from "@/domain/order";
import { buildStops, computeSchedule, departureInstant, partitionByPin } from "@/domain/tour";
import {
  EDITABLE_TOUR_STATUSES,
  isPermutation,
  isTourEditable,
  releaseBlocker,
  sameOrder,
} from "@/domain/tour-plan";
import { canTransition, isReReleasable } from "@/domain/tour-status";
import type { PrismaClient } from "@/generated/prisma/client";

import { listConfirmedOrdersForDate } from "./orders";
import { RoutingError, type RoutingProvider } from "./routing";
import type { AppSettings } from "./settings";
import type { TourWarning } from "./tour-builder";
import { getTourDiffView, loadReleaseTour, type TourDiffView } from "./tour-rerelease";

/**
 * Tour planning (NUD-042): the read model of `/admin/tours` and the mutations behind its buttons.
 * Every mutation here is called by an action that has already checked the ADMIN role
 * (`tour-actions.ts`). RELEASED, IN_PROGRESS and COMPLETED tours are never changed here
 * (`tour_not_editable`); changing a released tour is NUD-043.
 */

export type PlanStop = {
  id: string;
  sequence: number;
  customerId: string;
  customerNumber: string;
  name: string;
  street: string;
  postalCode: string;
  city: string;
  lat: number;
  lng: number;
  /** ISO instant; shown in the factory time zone. */
  etaAt: string | null;
  legDistanceM: number | null;
  legDurationS: number | null;
  /** Distinct products on the stop (all linked orders). */
  itemCount: number;
  orderCount: number;
  hasStorePhoto: boolean;
  hasParkingPhoto: boolean;
  status: "PENDING" | "DELIVERED" | "PROBLEM";
  /** Set by a re-release (NUD-043): the stop was added or its quantities changed. */
  changeKind: "ADDED" | "CHANGED" | null;
};

export type PlanDriver = { id: string; displayName: string; username: string; active: boolean };

export type PlanTour = {
  id: string;
  status: "DRAFT" | "OPTIMIZED" | "RELEASED" | "IN_PROGRESS" | "COMPLETED";
  locked: boolean;
  isOutdated: boolean;
  approximate: boolean;
  driverId: string | null;
  /** `updatedAt` as ISO string: the release call must quote it, so the office releases what it saw. */
  version: string;
  totalDistanceM: number | null;
  totalDurationS: number | null;
  releasedAt: string | null;
  /** 0 = never released, 1 = first release, +1 per re-release that changed something. */
  releaseRevision: number;
  reReleasedAt: string | null;
  /**
   * For a released tour whose orders changed: what differs between the released stops and the
   * confirmed orders now (the banner's diff). `null` when the tour is not outdated or not released.
   */
  diff: TourDiffView | null;
  depot: { name: string; address: string; lat: number; lng: number } | null;
  /** GeoJSON LineString coordinates (`[lng, lat]`). */
  geometry: Array<[number, number]> | null;
  stops: PlanStop[];
};

export type TourPlan = {
  /** `YYYY-MM-DD` */
  date: string;
  timezone: string;
  tour: PlanTour | null;
  /** Customers with confirmed orders for the day that are not routable (pin not confirmed). */
  warnings: TourWarning[];
  confirmedOrderCount: number;
  drivers: PlanDriver[];
};

function readGeometry(value: unknown): Array<[number, number]> | null {
  const parsed = z
    .object({ coordinates: z.array(z.tuple([z.number(), z.number()])) })
    .safeParse(value);
  return parsed.success && parsed.data.coordinates.length > 1 ? parsed.data.coordinates : null;
}

function readDepot(value: unknown): PlanTour["depot"] {
  const parsed = z
    .object({
      name: z.string(),
      address: z.string(),
      lat: z.number(),
      lng: z.number(),
    })
    .safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** The latest tour of the day (v1 has one) with everything the planning screen shows. */
export async function getTourPlan(
  db: PrismaClient,
  rawDate: unknown,
  timezone: string,
): Promise<TourPlan | null> {
  const date = typeof rawDate === "string" ? parseCalendarDate(rawDate) : null;
  if (!date) return null;

  const tour = await db.tour.findFirst({
    where: { date },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: {
      stops: {
        orderBy: { sequence: "asc" },
        include: {
          customer: {
            select: {
              customerNumber: true,
              name: true,
              street: true,
              postalCode: true,
              city: true,
              lat: true,
              lng: true,
              photos: { where: { isCurrent: true }, select: { kind: true } },
            },
          },
          orders: { select: { order: { select: { items: { select: { productId: true } } } } } },
        },
      },
    },
  });

  const releaseTour =
    tour && tour.isOutdated && isReReleasable(tour.status)
      ? await loadReleaseTour(db, tour.id)
      : null;
  const diff = releaseTour ? await getTourDiffView(db, releaseTour) : null;

  const orders = await listConfirmedOrdersForDate(db, date);
  const planned = buildStops(orders);
  const customers = await db.customer.findMany({
    where: { id: { in: planned.map((s) => s.customerId) } },
    select: {
      id: true,
      customerNumber: true,
      name: true,
      lat: true,
      lng: true,
      pinConfirmed: true,
    },
  });
  const byId = new Map(customers.map((c) => [c.id, c]));
  const { unrouted } = partitionByPin(planned, byId);
  const warnings: TourWarning[] = unrouted.map((stop) => ({
    code: "PIN_UNCONFIRMED",
    customerId: stop.customerId,
    customerNumber: byId.get(stop.customerId)?.customerNumber ?? "",
    name: byId.get(stop.customerId)?.name ?? "",
    orderIds: stop.orderIds,
  }));

  const drivers = await db.user.findMany({
    where: {
      role: "DRIVER",
      OR: [{ active: true }, ...(tour?.driverId ? [{ id: tour.driverId }] : [])],
    },
    orderBy: [{ displayName: "asc" }, { id: "asc" }],
    select: { id: true, displayName: true, username: true, active: true },
  });

  return {
    date: formatCalendarDate(date),
    timezone,
    warnings,
    confirmedOrderCount: orders.length,
    drivers: drivers.map((d) => ({
      id: d.id,
      displayName: d.displayName,
      username: d.username ?? "",
      active: d.active,
    })),
    tour: tour
      ? {
          id: tour.id,
          status: tour.status,
          locked: tour.locked,
          isOutdated: tour.isOutdated,
          approximate: tour.approximate,
          driverId: tour.driverId,
          version: tour.updatedAt.toISOString(),
          totalDistanceM: tour.totalDistanceM,
          totalDurationS: tour.totalDurationS,
          releasedAt: tour.releasedAt?.toISOString() ?? null,
          releaseRevision: tour.releaseRevision,
          reReleasedAt: tour.reReleasedAt?.toISOString() ?? null,
          diff,
          depot: readDepot(tour.depotSnapshot),
          geometry: readGeometry(tour.geometry),
          stops: tour.stops.flatMap((s) =>
            s.customer.lat === null || s.customer.lng === null
              ? []
              : [
                  {
                    id: s.id,
                    sequence: s.sequence,
                    customerId: s.customerId,
                    customerNumber: s.customer.customerNumber,
                    name: s.customer.name,
                    street: s.customer.street,
                    postalCode: s.customer.postalCode,
                    city: s.customer.city,
                    lat: s.customer.lat,
                    lng: s.customer.lng,
                    etaAt: s.etaAt?.toISOString() ?? null,
                    legDistanceM: s.legDistanceM,
                    legDurationS: s.legDurationS,
                    itemCount: new Set(
                      s.orders.flatMap((o) => o.order.items.map((i) => i.productId)),
                    ).size,
                    orderCount: s.orders.length,
                    hasStorePhoto: s.customer.photos.some((p) => p.kind === "STORE"),
                    hasParkingPhoto: s.customer.photos.some((p) => p.kind === "PARKING"),
                    status: s.status,
                    changeKind: s.changeKind,
                  },
                ],
          ),
        }
      : null,
  };
}

export type PlanError =
  | "invalid"
  | "not_found"
  | "tour_not_editable"
  | "stops_changed"
  | "pin_missing"
  | "too_many_stops"
  | "conflict"
  | "no_stops"
  | "driver_required"
  | "driver_invalid"
  | "outdated"
  | "not_released";

export type PlanResult<T = object> = ({ ok: true } & T) | { ok: false; error: PlanError };

const idSchema = z.string().trim().min(1).max(64);

const reorderSchema = z
  .object({ tourId: idSchema, orderedStopIds: z.array(idSchema).max(200) })
  .strict();
const lockSchema = z.object({ tourId: idSchema, locked: z.boolean() }).strict();
const driverSchema = z.object({ tourId: idSchema, driverId: idSchema.nullable() }).strict();
const releaseSchema = z.object({ tourId: idSchema, version: z.string().max(40) }).strict();

const fail = (error: PlanError): { ok: false; error: PlanError } => ({ ok: false, error });

function lockKey(date: Date): string {
  return `tour:${date.toISOString().slice(0, 10)}`;
}

export type ReorderDeps = {
  db: PrismaClient;
  provider: RoutingProvider;
  loadSettings: () => Promise<Pick<
    AppSettings,
    "timezone" | "departureTime" | "serviceMinutesPerStop"
  > | null>;
};

/**
 * Manual reorder: the stops get the requested order, legs / ETAs / geometry / totals are
 * recomputed with `RoutingProvider.route()` (no re-optimization). The request must name exactly
 * the stops the tour has now (otherwise `stops_changed`: the page is out of date). The `locked`
 * flag is not touched.
 */
export async function reorderStopsWith(
  deps: ReorderDeps,
  rawInput: unknown,
): Promise<PlanResult<{ changed: boolean; approximate: boolean }>> {
  const input = reorderSchema.safeParse(rawInput);
  if (!input.success) return fail("invalid");
  const { db, provider } = deps;
  const tour = await db.tour.findUnique({
    where: { id: input.data.tourId },
    include: {
      stops: {
        orderBy: { sequence: "asc" },
        include: { customer: { select: { lat: true, lng: true } } },
      },
    },
  });
  if (!tour) return fail("not_found");
  if (!isTourEditable(tour.status)) return fail("tour_not_editable");
  const currentIds = tour.stops.map((s) => s.id);
  if (!isPermutation(currentIds, input.data.orderedStopIds)) return fail("stops_changed");
  if (sameOrder(currentIds, input.data.orderedStopIds)) {
    return { ok: true, changed: false, approximate: tour.approximate };
  }
  const settings = await deps.loadSettings();
  const depot = readDepot(tour.depotSnapshot);
  if (!settings || !depot) return fail("invalid");

  const byId = new Map(tour.stops.map((s) => [s.id, s]));
  const ordered = input.data.orderedStopIds.map((id) => byId.get(id)!);
  const points: Array<{ lat: number; lng: number }> = [];
  for (const stop of ordered) {
    if (stop.customer.lat === null || stop.customer.lng === null) return fail("pin_missing");
    points.push({ lat: stop.customer.lat, lng: stop.customer.lng });
  }

  let route;
  try {
    route = await provider.route({
      depot: { lat: depot.lat, lng: depot.lng },
      orderedStops: points,
    });
  } catch (error) {
    if (error instanceof RoutingError && error.code === "TOO_MANY_STOPS") {
      return fail("too_many_stops");
    }
    throw error;
  }
  if (route.legs.length !== ordered.length + 1) {
    throw new Error(
      `Routing provider returned ${route.legs.length} legs, expected ${ordered.length + 1}`,
    );
  }
  const legs = route.legs.map((l) => ({
    distanceM: Math.round(l.distanceM),
    durationS: Math.round(l.durationS),
  }));
  const serviceSeconds = settings.serviceMinutesPerStop * 60;
  const schedule = computeSchedule({
    departure: departureInstant(tour.date, settings.departureTime, settings.timezone),
    legDurationsS: legs.map((l) => l.durationS),
    serviceSecondsPerStop: serviceSeconds,
  });

  return db.$transaction(
    async (tx): Promise<PlanResult<{ changed: boolean; approximate: boolean }>> => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey(tour.date)}))`;
      // The tour changed (rebuilt, released, reordered elsewhere) while we were routing.
      const fresh = await tx.tour.findUnique({
        where: { id: tour.id },
        select: { updatedAt: true, status: true },
      });
      if (!fresh || fresh.updatedAt.getTime() !== tour.updatedAt.getTime()) return fail("conflict");
      if (!isTourEditable(fresh.status)) return fail("tour_not_editable");
      await tx.tour.update({
        where: { id: tour.id },
        data: {
          geometry: route.geometry,
          totalDistanceM: Math.round(legs.reduce((sum, l) => sum + l.distanceM, 0)),
          totalDurationS: schedule.totalDurationS,
          approximate: route.approximate,
        },
      });
      for (const [index, stop] of ordered.entries()) {
        await tx.stop.update({
          where: { id: stop.id },
          data: {
            sequence: index + 1,
            etaAt: schedule.etas[index],
            legDistanceM: legs[index].distanceM,
            legDurationS: legs[index].durationS,
          },
        });
      }
      return { ok: true, changed: true, approximate: route.approximate };
    },
    { timeout: 20_000, maxWait: 10_000 },
  );
}

/** Lock toggle of an unreleased tour (a locked tour keeps its order when it is rebuilt). */
export async function setTourLockedWith(db: PrismaClient, rawInput: unknown): Promise<PlanResult> {
  const input = lockSchema.safeParse(rawInput);
  if (!input.success) return fail("invalid");
  const result = await db.tour.updateMany({
    where: { id: input.data.tourId, status: { in: [...EDITABLE_TOUR_STATUSES] } },
    data: { locked: input.data.locked },
  });
  if (result.count === 1) return { ok: true };
  const exists = await db.tour.findUnique({
    where: { id: input.data.tourId },
    select: { id: true },
  });
  return fail(exists ? "tour_not_editable" : "not_found");
}

/** Assigns an active driver (or clears the assignment with `null`) on an unreleased tour. */
export async function assignDriverWith(db: PrismaClient, rawInput: unknown): Promise<PlanResult> {
  const input = driverSchema.safeParse(rawInput);
  if (!input.success) return fail("invalid");
  if (input.data.driverId !== null) {
    const driver = await db.user.findFirst({
      where: { id: input.data.driverId, role: "DRIVER", active: true },
      select: { id: true },
    });
    if (!driver) return fail("driver_invalid");
  }
  const result = await db.tour.updateMany({
    where: { id: input.data.tourId, status: { in: [...EDITABLE_TOUR_STATUSES] } },
    data: { driverId: input.data.driverId },
  });
  if (result.count === 1) return { ok: true };
  const exists = await db.tour.findUnique({
    where: { id: input.data.tourId },
    select: { id: true },
  });
  return fail(exists ? "tour_not_editable" : "not_found");
}

/**
 * Release: DRAFT / OPTIMIZED -> RELEASED with `releasedAt`. Needs at least one stop, an assigned
 * and still active driver, and a tour that is not outdated (orders changed after it was built).
 * `version` is the `updatedAt` the office saw in the confirmation dialog; if the tour changed since
 * (`conflict`) nothing is released.
 */
export async function releaseTourWith(
  db: PrismaClient,
  rawInput: unknown,
  now: Date = new Date(),
): Promise<PlanResult<{ releasedAt: string; stopCount: number }>> {
  const input = releaseSchema.safeParse(rawInput);
  if (!input.success) return fail("invalid");
  const version = new Date(input.data.version);
  if (!Number.isFinite(version.getTime())) return fail("invalid");

  return db.$transaction(
    async (tx): Promise<PlanResult<{ releasedAt: string; stopCount: number }>> => {
      const tour = await tx.tour.findUnique({
        where: { id: input.data.tourId },
        include: {
          _count: { select: { stops: true } },
          driver: { select: { active: true, role: true } },
        },
      });
      if (!tour) return fail("not_found");
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey(tour.date)}))`;
      const blocker = releaseBlocker({
        status: tour.status,
        stopCount: tour._count.stops,
        driverId: tour.driverId,
        isOutdated: tour.isOutdated,
      });
      if (blocker) return fail(blocker);
      if (!canTransition(tour.status, "RELEASED")) return fail("tour_not_editable");
      if (!tour.driver?.active || tour.driver.role !== "DRIVER") return fail("driver_invalid");
      if (tour.updatedAt.getTime() !== version.getTime()) return fail("conflict");
      const updated = await tx.tour.updateMany({
        where: {
          id: tour.id,
          updatedAt: tour.updatedAt,
          status: { in: [...EDITABLE_TOUR_STATUSES] },
        },
        data: { status: "RELEASED", releasedAt: now, releaseRevision: 1 },
      });
      if (updated.count !== 1) return fail("conflict");
      return { ok: true, releasedAt: now.toISOString(), stopCount: tour._count.stops };
    },
    { timeout: 20_000, maxWait: 10_000 },
  );
}
