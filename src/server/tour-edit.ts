import { z } from "zod";

import { normalizeTrips, tripPausesS, tripVehicleIds, vehiclesForTrips } from "@/domain/fleet";
import { isPastDeliveryDate, parseCalendarDate } from "@/domain/order";
import { routingPoint } from "@/domain/parking";
import { calendarDayIn, type Depot, DepotNotSetError } from "@/domain/settings";
import { departureInstant } from "@/domain/tour";
import { isStopMovable, mergePendingOrder } from "@/domain/tour-edit";
import { sameOrder } from "@/domain/tour-plan";
import { canTransition, deriveTourStatus, isReReleasable } from "@/domain/tour-status";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";

import { recordAudit } from "./audit";
import { RoutingError, type RoutingProvider } from "./routing";
import { customerLocationSelect } from "./routing-points";
import type { AppSettings } from "./settings";
import { type PlanResult, readDepot } from "./tour-planning";
import { readStopItems } from "./tour-rerelease";
import { type RoutedTrips, routeTrips, scheduleTrips } from "./tour-routing";

/**
 * "Bearbeiten" (NUD-135, D29): the office changes the driver of a tour, the order of its stops and
 * moves stops to another tour of the same date. Works on unreleased tours directly and on
 * RELEASED / IN_PROGRESS tours through the "tour was updated" path of NUD-043: the revision goes up,
 * `reReleasedAt` / `lastChange` are set and a stop that arrives on a released tour carries the
 * `ADDED` marker. A COMPLETED tour is history; completed stops (DELIVERED / PROBLEM) can neither be
 * moved nor reordered. The date of a tour is never edited. The caller has checked the ADMIN role.
 *
 * Simplest rules (backlog §9): a moved stop is appended to the end of the target tour (the office
 * reorders it there), keeps its id, orders and quantities, and a target that already has a stop of
 * that customer is refused. Legs / ETAs / geometry of every touched tour are recomputed with
 * `RoutingProvider.route()` (no re-optimization).
 */

export const MAX_TOURS_PER_DAY = 10;

const idSchema = z.string().trim().min(1).max(64);

const editSchema = z
  .object({
    tourId: idSchema,
    /** `updatedAt` of the tour the office saw. */
    version: z.string().max(40),
    driverId: idSchema.nullable(),
    /** NUD-146: the vehicle of the tour; omitted = unchanged, `null` = none. */
    vehicleId: idSchema.nullable().optional(),
    /** The pending stops that stay on the tour, in the new order. */
    orderedStopIds: z.array(idSchema).max(200),
    moves: z.array(z.object({ stopId: idSchema, targetTourId: idSchema }).strict()).max(200),
  })
  .strict();

export type EditTourOk = {
  /** False when nothing differed from what is stored. */
  changed: boolean;
  /** `releaseRevision` of the edited tour afterwards. */
  revision: number;
  moved: number;
};

export type EditTourDeps = {
  db: PrismaClient;
  actorId: string;
  provider: RoutingProvider;
  loadSettings: () => Promise<Pick<
    AppSettings,
    "timezone" | "departureTime" | "serviceMinutesPerStop"
  > | null>;
};

const fail = (error: Extract<PlanResult, { ok: false }>["error"]) => ({
  ok: false as const,
  error,
});

class ConflictError extends Error {}

const tourInclude = {
  stops: {
    orderBy: { sequence: "asc" },
    include: { customer: { select: customerLocationSelect } },
  },
} satisfies Prisma.TourInclude;

type EditTour = Prisma.TourGetPayload<{ include: typeof tourInclude }>;
type EditStop = EditTour["stops"][number];

/** Fingerprint of the stops (id, tour, status): a driver completing a stop meanwhile changes it. */
function signature(tour: EditTour): string {
  return `${tour.updatedAt.getTime()}|${tour.status}|${tour.stops
    .map((s) => `${s.id}:${s.status}`)
    .join(",")}`;
}

type Routed = {
  /** Final stops in order. */
  stops: EditStop[];
  /** Trip of each final stop (reload trips, NUD-147; normalized). */
  trips: number[];
  /** Vehicle of each final stop's trip, `null` = the tour's vehicle (NUD-158). */
  vehicleIds: Array<string | null>;
  route: RoutedTrips | null;
  legs: Array<{ distanceM: number; durationS: number }>;
  etas: Date[];
  totalDurationS: number | null;
};

async function routeStops(
  deps: EditTourDeps,
  tour: EditTour,
  stops: EditStop[],
  rawTrips: readonly number[],
  settings: Pick<AppSettings, "timezone" | "departureTime" | "serviceMinutesPerStop">,
  tourVehicleId: string | null = tour.vehicleId,
): Promise<Routed | "invalid" | "pin_missing" | "too_many_stops"> {
  if (stops.length === 0) {
    return {
      stops,
      trips: [],
      vehicleIds: [],
      route: null,
      legs: [],
      etas: [],
      totalDurationS: null,
    };
  }
  const trips = normalizeTrips(rawTrips);
  // A trip keeps its vehicle (NUD-158): raw trip numbers are those of this tour before the edit.
  const vehicleIds = vehiclesForTrips(tour.stops, rawTrips);
  const depot = readDepot(tour.depotSnapshot);
  if (!depot) return "invalid";
  const points: Array<{ lat: number; lng: number }> = [];
  for (const stop of stops) {
    const point = routingPoint(stop.customer);
    if (!point) return "pin_missing";
    points.push({ lat: point.lat, lng: point.lng });
  }
  let route: RoutedTrips;
  try {
    route = await routeTrips(deps.provider, { lat: depot.lat, lng: depot.lng }, points, trips);
  } catch (error) {
    if (error instanceof RoutingError && error.code === "TOO_MANY_STOPS") return "too_many_stops";
    throw error;
  }
  const schedule = scheduleTrips(route, trips, {
    departure: departureInstant(tour.date, settings.departureTime, settings.timezone),
    serviceSecondsPerStop: settings.serviceMinutesPerStop * 60,
    pausesS: tripPausesS(tripVehicleIds(trips, vehicleIds, tourVehicleId)),
  });
  return {
    stops,
    trips,
    vehicleIds,
    route,
    legs: route.stopLegs,
    etas: schedule.etas,
    totalDurationS: schedule.totalDurationS,
  };
}

const lockKey = (date: Date) => `tour:${date.toISOString().slice(0, 10)}`;

/**
 * Applies one edit: `{tourId, version, driverId, orderedStopIds, moves}`. Everything is validated
 * before anything is written and then written in one transaction behind the per-date lock; if any
 * touched tour or its stops changed meanwhile nothing is written (`conflict`).
 */
export async function editTourWith(
  deps: EditTourDeps,
  rawInput: unknown,
  now: Date = new Date(),
): Promise<PlanResult<EditTourOk>> {
  const input = editSchema.safeParse(rawInput);
  if (!input.success) return fail("invalid");
  const { tourId, driverId, orderedStopIds, moves } = input.data;
  const vehicleId = input.data.vehicleId;
  const version = new Date(input.data.version);
  if (!Number.isFinite(version.getTime())) return fail("invalid");
  const { db } = deps;

  const tour = await db.tour.findUnique({ where: { id: tourId }, include: tourInclude });
  if (!tour) return fail("not_found");
  if (tour.status === "COMPLETED") return fail("tour_not_editable");
  if (tour.updatedAt.getTime() !== version.getTime()) return fail("conflict");
  const released = isReReleasable(tour.status);

  // ---- driver
  const driverChanged = driverId !== tour.driverId;
  if (driverChanged) {
    if (driverId === null) {
      if (released) return fail("driver_required");
    } else {
      const driver = await db.user.findFirst({
        where: { id: driverId, role: "DRIVER", active: true },
        select: { id: true },
      });
      if (!driver) return fail("driver_invalid");
    }
  }

  // ---- vehicle (NUD-146): like the driver, a released tour cannot lose it; legacy tours without one stay as they are
  const vehicleChanged = vehicleId !== undefined && vehicleId !== tour.vehicleId;
  if (vehicleChanged) {
    if (vehicleId === null) {
      if (released) return fail("vehicle_required");
    } else {
      const vehicle = await db.vehicle.findFirst({
        where: { id: vehicleId, active: true },
        select: { id: true },
      });
      if (!vehicle) return fail("vehicle_invalid");
    }
  }

  // ---- moves
  const movedIds = new Set(moves.map((m) => m.stopId));
  if (movedIds.size !== moves.length) return fail("invalid");
  const stopById = new Map(tour.stops.map((s) => [s.id, s]));
  for (const move of moves) {
    const stop = stopById.get(move.stopId);
    if (!stop) return fail("stops_changed");
    if (!isStopMovable(stop)) return fail("stop_locked");
    if (move.targetTourId === tour.id) return fail("target_invalid");
  }
  const targetIds = [...new Set(moves.map((m) => m.targetTourId))];
  const targets = new Map<string, EditTour>(
    (
      await db.tour.findMany({
        where: { id: { in: targetIds }, date: tour.date, status: { not: "COMPLETED" } },
        include: tourInclude,
      })
    ).map((t) => [t.id, t]),
  );
  if (targets.size !== targetIds.length) return fail("target_invalid");
  const incoming = new Map<string, EditStop[]>(targetIds.map((id) => [id, []]));
  for (const move of moves) {
    const stop = stopById.get(move.stopId)!;
    const target = targets.get(move.targetTourId)!;
    const list = incoming.get(target.id)!;
    if (
      target.stops.some((s) => s.customerId === stop.customerId) ||
      list.some((s) => s.customerId === stop.customerId)
    ) {
      return fail("customer_in_target");
    }
    list.push(stop);
  }

  // ---- new order of the edited tour
  const finalIds = mergePendingOrder(tour.stops, movedIds, orderedStopIds);
  if (!finalIds) return fail("stops_changed");
  const currentIds = tour.stops.map((s) => s.id);
  const stayingIds = currentIds.filter((id) => !movedIds.has(id));
  const reordered = !sameOrder(stayingIds, finalIds);
  if (!driverChanged && !vehicleChanged && !reordered && moves.length === 0) {
    return { ok: true, changed: false, revision: tour.releaseRevision, moved: 0 };
  }

  // ---- routing for every tour whose stops changed (outside the transaction, like the builder)
  const settings = await deps.loadSettings();
  if (!settings) return fail("invalid");
  const needsRoute = reordered || moves.length > 0;
  let sourceRouted: Routed | null = null;
  const targetRouted = new Map<string, Routed>();
  if (needsRoute) {
    const finalStops = finalIds.map((id) => stopById.get(id)!);
    // Trip boundaries stay at their positions; moved-away stops leave the trips they were in.
    const stayingTrips = tour.stops.filter((s) => !movedIds.has(s.id)).map((s) => s.trip);
    const result = await routeStops(
      deps,
      tour,
      finalStops,
      stayingTrips,
      settings,
      vehicleId !== undefined ? vehicleId : tour.vehicleId,
    );
    if (typeof result === "string") return fail(result);
    sourceRouted = result;
    for (const [id, add] of incoming) {
      const target = targets.get(id)!;
      // An arriving stop joins the last trip of the target tour.
      const lastTrip = Math.max(1, ...target.stops.map((s) => s.trip));
      const routed = await routeStops(
        deps,
        target,
        [...target.stops, ...add],
        [...target.stops.map((s) => s.trip), ...add.map(() => lastTrip)],
        settings,
      );
      if (typeof routed === "string") return fail(routed);
      targetRouted.set(id, routed);
    }
  }

  const sourceRevision =
    released && (driverChanged || vehicleChanged || needsRoute) ? tour.releaseRevision + 1 : null;
  const customerLabel = (stop: EditStop) => ({
    customerId: stop.customerId,
    customerNumber: stop.customer.customerNumber,
    name: stop.customer.name,
    items: readStopItems(stop.items),
  });
  const removedStops = moves.map((m) => stopById.get(m.stopId)!);

  try {
    await db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey(tour.date)}))`;
        // Recheck every touched tour: nothing may have changed since it was read.
        const touched = [tour, ...targets.values()];
        const fresh = await tx.tour.findMany({
          where: { id: { in: touched.map((t) => t.id) } },
          include: tourInclude,
        });
        if (fresh.length !== touched.length) throw new ConflictError();
        for (const t of touched) {
          const current = fresh.find((f) => f.id === t.id);
          if (!current || signature(current) !== signature(t)) throw new ConflictError();
        }

        /** Writes the final order, ETAs and legs of one tour; completed stops only change place. */
        const writeSequence = async (
          routed: Routed,
          current: EditTour,
          moveInto?: { revision: number | null },
        ) => {
          for (const [index, stop] of routed.stops.entries()) {
            const sequence = index + 1;
            const isIncoming = stop.tourId !== current.id;
            if (isIncoming) {
              const marker =
                moveInto?.revision != null
                  ? {
                      changeKind: "ADDED" as const,
                      changedInRevision: moveInto.revision,
                      adminChangedAt: now,
                    }
                  : { changeKind: null, changedInRevision: null };
              const updated = await tx.stop.updateMany({
                where: { id: stop.id, tourId: stop.tourId, status: "PENDING" },
                data: {
                  tourId: current.id,
                  sequence,
                  trip: routed.trips[index],
                  vehicleId: routed.vehicleIds[index] ?? null,
                  etaAt: routed.etas[index],
                  legDistanceM: routed.legs[index].distanceM,
                  legDurationS: routed.legs[index].durationS,
                  previousItems: Prisma.DbNull,
                  ...marker,
                },
              });
              if (updated.count !== 1) throw new ConflictError();
            } else if (isStopMovable(stop)) {
              await tx.stop.update({
                where: { id: stop.id },
                data: {
                  sequence,
                  trip: routed.trips[index],
                  vehicleId: routed.vehicleIds[index] ?? null,
                  etaAt: routed.etas[index],
                  legDistanceM: routed.legs[index].distanceM,
                  legDurationS: routed.legs[index].durationS,
                },
              });
            } else if (
              stop.sequence !== sequence ||
              stop.trip !== routed.trips[index] ||
              stop.vehicleId !== (routed.vehicleIds[index] ?? null)
            ) {
              await tx.stop.update({
                where: { id: stop.id },
                data: {
                  sequence,
                  trip: routed.trips[index],
                  vehicleId: routed.vehicleIds[index] ?? null,
                },
              });
            }
          }
        };

        const tourData = (routed: Routed, current: EditTour) => {
          const finalStatuses = routed.stops.map((s) => (isStopMovable(s) ? "PENDING" : s.status));
          const status = deriveTourStatus(current.status, finalStatuses);
          if (!canTransition(current.status, status)) {
            throw new Error(`Illegal tour transition ${current.status} -> ${status}`);
          }
          return {
            geometry: routed.route?.geometry ?? Prisma.DbNull,
            totalDistanceM: routed.route ? routed.route.totalDistanceM : null,
            totalDurationS: routed.totalDurationS,
            approximate: routed.route?.approximate ?? false,
            status,
            ...(status === "COMPLETED" && current.status !== "COMPLETED"
              ? { completedAt: now }
              : {}),
          };
        };

        // Edited tour.
        if (sourceRouted) {
          await writeSequence(sourceRouted, tour);
        }
        await tx.tour.update({
          where: { id: tour.id },
          data: {
            ...(sourceRouted ? tourData(sourceRouted, tour) : {}),
            ...(driverChanged ? { driverId } : {}),
            ...(vehicleChanged ? { vehicleId } : {}),
            ...(sourceRevision !== null
              ? {
                  releaseRevision: sourceRevision,
                  reReleasedAt: now,
                  lastChange: {
                    revision: sourceRevision,
                    at: now.toISOString(),
                    added: [],
                    removed: removedStops.map(customerLabel),
                    changed: [],
                    edited: true,
                  },
                }
              : {}),
          },
        });
        if (driverChanged) {
          await recordAudit(tx, {
            actorId: deps.actorId,
            entity: "Tour",
            entityId: tour.id,
            action: "tour.assign_driver",
            diff: {
              driverId: { from: tour.driverId, to: driverId },
              ...(sourceRevision !== null ? { revision: sourceRevision } : {}),
            },
          });
        }
        if (vehicleChanged) {
          await recordAudit(tx, {
            actorId: deps.actorId,
            entity: "Tour",
            entityId: tour.id,
            action: "tour.assign_vehicle",
            diff: {
              vehicleId: { from: tour.vehicleId, to: vehicleId },
              ...(sourceRevision !== null ? { revision: sourceRevision } : {}),
            },
          });
        }
        if (reordered) {
          await recordAudit(tx, {
            actorId: deps.actorId,
            entity: "Tour",
            entityId: tour.id,
            action: "tour.reorder",
            diff: {
              date: tour.date.toISOString().slice(0, 10),
              customerIdsBefore: stayingIds.map((id) => stopById.get(id)!.customerId),
              customerIdsAfter: finalIds.map((id) => stopById.get(id)!.customerId),
              ...(sourceRevision !== null ? { revision: sourceRevision } : {}),
            },
          });
        }

        // Target tours.
        for (const [id, add] of incoming) {
          const target = targets.get(id)!;
          const routed = targetRouted.get(id)!;
          const targetReleased = isReReleasable(target.status);
          const revision = targetReleased ? target.releaseRevision + 1 : null;
          await writeSequence(routed, target, { revision });
          await tx.tour.update({
            where: { id },
            data: {
              ...tourData(routed, target),
              ...(revision !== null
                ? {
                    releaseRevision: revision,
                    reReleasedAt: now,
                    lastChange: {
                      revision,
                      at: now.toISOString(),
                      added: add.map(customerLabel),
                      removed: [],
                      changed: [],
                      edited: true,
                    },
                  }
                : {}),
            },
          });
        }

        // One entry per move on both tours.
        for (const move of moves) {
          const stop = stopById.get(move.stopId)!;
          for (const entityId of [tour.id, move.targetTourId]) {
            await recordAudit(tx, {
              actorId: deps.actorId,
              entity: "Tour",
              entityId,
              action: "tour.move_stop",
              diff: {
                customerId: stop.customerId,
                fromTourId: tour.id,
                toTourId: move.targetTourId,
              },
            });
          }
        }
      },
      { timeout: 30_000, maxWait: 10_000 },
    );
  } catch (error) {
    if (error instanceof ConflictError) return fail("conflict");
    throw error;
  }
  return {
    ok: true,
    changed: true,
    revision: sourceRevision ?? tour.releaseRevision,
    moved: moves.length,
  };
}

// ---------------------------------------------------------------------------------------------
// "+ Tour": an empty tour for the date

const createSchema = z.object({ date: z.string().trim().min(1).max(10) }).strict();

export type CreateEmptyTourResult =
  | { ok: true; tourId: string }
  | {
      ok: false;
      error: "invalid_date" | "date_in_past" | "depot_not_set" | "too_many_tours";
    };

export type CreateEmptyTourDeps = {
  db: PrismaClient;
  actorId: string;
  requireDepot: () => Promise<Depot>;
  loadSettings: () => Promise<Pick<AppSettings, "timezone"> | null>;
};

/**
 * Creates an empty tour (OPTIMIZED, no stops, no driver) for a delivery day, the "+ Tour" tab of
 * the planning page. Stops arrive by moving them from another tour (Bearbeiten). Past days and
 * more than `MAX_TOURS_PER_DAY` tours are refused.
 */
export async function createEmptyTourWith(
  deps: CreateEmptyTourDeps,
  rawInput: unknown,
  now: Date = new Date(),
): Promise<CreateEmptyTourResult> {
  const input = createSchema.safeParse(rawInput);
  const date = input.success ? parseCalendarDate(input.data.date) : null;
  if (!date) return { ok: false, error: "invalid_date" };
  let depot: Depot;
  try {
    depot = await deps.requireDepot();
  } catch (error) {
    if (error instanceof DepotNotSetError) return { ok: false, error: "depot_not_set" };
    throw error;
  }
  const settings = await deps.loadSettings();
  if (!settings) return { ok: false, error: "depot_not_set" };
  const { y, m, d } = calendarDayIn(now, settings.timezone);
  if (isPastDeliveryDate(date, new Date(Date.UTC(y, m - 1, d)))) {
    return { ok: false, error: "date_in_past" };
  }
  return deps.db.$transaction(async (tx): Promise<CreateEmptyTourResult> => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey(date)}))`;
    if ((await tx.tour.count({ where: { date } })) >= MAX_TOURS_PER_DAY) {
      return { ok: false, error: "too_many_tours" };
    }
    const tour = await tx.tour.create({
      data: {
        date,
        status: "OPTIMIZED",
        optimizedAt: now,
        depotSnapshot: {
          name: depot.name,
          address: depot.address,
          lat: depot.lat,
          lng: depot.lng,
        },
      },
      select: { id: true },
    });
    await recordAudit(tx, {
      actorId: deps.actorId,
      entity: "Tour",
      entityId: tour.id,
      action: "tour.create_empty",
      diff: { date: date.toISOString().slice(0, 10) },
    });
    return { ok: true, tourId: tour.id };
  });
}
