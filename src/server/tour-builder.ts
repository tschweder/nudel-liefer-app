import { isOpenTour } from "@/domain/day-tours";
import { isPastDeliveryDate, parseCalendarDate } from "@/domain/order";
import { calendarDayIn, type Depot, DepotNotSetError } from "@/domain/settings";
import {
  buildStops,
  computeSchedule,
  departureInstant,
  mergeLockedOrder,
  partitionByPin,
  type PlannedStop,
} from "@/domain/tour";
import type { PrismaClient } from "@/generated/prisma/client";

import { recordAudit } from "./audit";
import { getDb } from "./db";
import { listConfirmedOrdersForDate } from "./orders";
import {
  getRoutingProvider,
  MAX_STOPS,
  type RouteResult,
  RoutingError,
  type RoutingProvider,
} from "./routing";
import { type AppSettings, getSettings, requireDepotConfigured } from "./settings";

/** A customer that has confirmed orders but no confirmed pin, so it is not part of the tour. */
export type TourWarning = {
  code: "PIN_UNCONFIRMED";
  customerId: string;
  customerNumber: string;
  name: string;
  orderIds: string[];
};

export type GenerateTourError =
  | "invalid_date"
  | "date_in_past"
  | "depot_not_set"
  | "no_stops"
  | "tour_not_editable"
  | "too_many_stops"
  | "conflict"
  /** Follow-up tour: the day has no tour, or a tour that is not COMPLETED yet. */
  | "follow_up_not_allowed"
  /** Follow-up tour: every confirmed order is already on a stop. */
  | "no_late_orders";

export type GenerateTourResult =
  | {
      ok: true;
      tourId: string;
      /**
       * created = new tour, replaced = unreleased tour rebuilt, locked_extended = locked tour kept,
       * follow_up = additional tour for the late orders of a day whose tours are all completed.
       */
      mode: "created" | "replaced" | "locked_extended" | "follow_up";
      stopCount: number;
      /** Customers appended to a locked tour / dropped from it because nothing is left to deliver. */
      addedCustomerIds: string[];
      removedCustomerIds: string[];
      approximate: boolean;
      warnings: TourWarning[];
    }
  | { ok: false; error: GenerateTourError; maxStops?: number; warnings: TourWarning[] };

export type TourBuilderDeps = {
  db: PrismaClient;
  /** The admin who asked for the (re)build; recorded in the audit log. */
  actorId: string;
  provider: RoutingProvider;
  /** Throws `DepotNotSetError` while the depot pin is not confirmed (`requireDepotConfigured`). */
  requireDepot: () => Promise<Depot>;
  loadSettings: () => Promise<Pick<
    AppSettings,
    "timezone" | "departureTime" | "serviceMinutesPerStop"
  > | null>;
  now?: () => Date;
};

const EDITABLE = ["DRAFT", "OPTIMIZED"] as const;

function parseDate(value: unknown): Date | null {
  if (typeof value === "string") return parseCalendarDate(value.trim());
  if (
    value instanceof Date &&
    Number.isFinite(value.getTime()) &&
    value.getTime() % 86_400_000 === 0
  )
    return value;
  return null;
}

/** Fingerprint of the confirmed orders: a change while we were routing makes the result stale. */
function orderSignature(orders: ReadonlyArray<{ id: string; updatedAt: Date }>): string {
  return orders.map((o) => `${o.id}@${o.updatedAt.getTime()}`).join("|");
}

/**
 * Builds (or rebuilds) the tour of one delivery day from its CONFIRMED orders.
 *
 * - Refuses without a confirmed depot (`depot_not_set`) and for past days.
 * - One stop per customer (orders merged, `StopOrder` links kept). Customers without a confirmed
 *   pin are left out and returned as `warnings`; they are never dropped silently.
 * - An unreleased tour (DRAFT / OPTIMIZED) is re-optimized and its stops are replaced. A LOCKED
 *   one keeps the order of its stops: customers that still have something to deliver stay where
 *   they are, new customers are appended at the end, customers without orders are removed, and
 *   legs / ETAs are recomputed with `route()`. A released, running or completed tour is refused
 *   (a released tour is updated by the re-release in tour-rerelease.ts).
 * - ETAs = `Settings.departureTime` in the factory time zone + cumulative driving legs + service
 *   minutes at every earlier stop. `Tour.totalDurationS` is driving plus service time.
 * - Every stop stores the quantities it was built with (`Stop.items`), the base of the change diff.
 *
 * The caller must have checked the ADMIN role (see `tour-actions.ts`).
 */
export async function generateTourWith(
  deps: TourBuilderDeps,
  rawDate: unknown,
  options: { followUp?: boolean } = {},
): Promise<GenerateTourResult> {
  const { db, provider } = deps;
  const followUp = options.followUp === true;
  const fail = (
    error: GenerateTourError,
    warnings: TourWarning[] = [],
    extra: { maxStops?: number } = {},
  ): GenerateTourResult => ({ ok: false, error, warnings, ...extra });

  const date = parseDate(rawDate);
  if (!date) return fail("invalid_date");

  let depot: Depot;
  try {
    depot = await deps.requireDepot();
  } catch (error) {
    if (error instanceof DepotNotSetError) return fail("depot_not_set");
    throw error;
  }
  const settings = await deps.loadSettings();
  if (!settings) return fail("depot_not_set");

  const now = (deps.now ?? (() => new Date()))();
  const { y, m, d } = calendarDayIn(now, settings.timezone);
  if (isPastDeliveryDate(date, new Date(Date.UTC(y, m - 1, d)))) return fail("date_in_past");

  const dayTours = await db.tour.findMany({
    where: { date },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: { stops: { orderBy: { sequence: "asc" }, select: { id: true, customerId: true } } },
  });
  // The newest tour of the day is the one that is rebuilt (v1 has one; a follow-up is newer).
  const latest = dayTours[0] ?? null;
  // A follow-up tour (NUD-099) is a NEW tour next to completed ones; it never rebuilds one.
  const existing = followUp ? null : latest;
  if (followUp && (dayTours.length === 0 || dayTours.some((t) => isOpenTour(t.status)))) {
    return fail("follow_up_not_allowed");
  }
  if (existing && !(EDITABLE as readonly string[]).includes(existing.status)) {
    return fail("tour_not_editable");
  }

  // Orders already on a stop of another tour of the day belong to that tour (NUD-099).
  const orders = await listConfirmedOrdersForDate(db, date, { tourId: existing?.id ?? null });
  if (followUp && orders.length === 0) return fail("no_late_orders");
  const signature = orderSignature(orders);
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
  const customerById = new Map(customers.map((c) => [c.id, c]));
  const { routable, unrouted } = partitionByPin(planned, customerById);
  const warnings: TourWarning[] = unrouted.map((stop) => {
    const c = customerById.get(stop.customerId);
    return {
      code: "PIN_UNCONFIRMED",
      customerId: stop.customerId,
      customerNumber: c?.customerNumber ?? "",
      name: c?.name ?? "",
      orderIds: stop.orderIds,
    };
  });

  const locked = !!existing?.locked;
  let ordered: PlannedStop[];
  let added: string[] = [];
  let removed: string[] = [];
  if (locked) {
    const merged = mergeLockedOrder(
      existing.stops.map((s) => s.customerId),
      routable,
    );
    ordered = merged.stops;
    added = merged.added;
    removed = merged.removed;
  } else {
    ordered = routable;
  }
  if (ordered.length === 0 && !existing) {
    return fail(followUp ? "no_late_orders" : "no_stops", warnings);
  }

  const location = (stop: PlannedStop) => {
    const c = customerById.get(stop.customerId)!;
    return { lat: c.lat as number, lng: c.lng as number };
  };
  const depotPoint = { lat: depot.lat, lng: depot.lng };
  const serviceSeconds = settings.serviceMinutesPerStop * 60;

  let route: RouteResult;
  try {
    if (locked || ordered.length === 0) {
      route = await provider.route({ depot: depotPoint, orderedStops: ordered.map(location) });
    } else {
      const optimized = await provider.optimize({
        depot: depotPoint,
        stops: ordered.map((s) => ({ id: s.customerId, location: location(s), serviceSeconds })),
      });
      const byCustomer = new Map(ordered.map((s) => [s.customerId, s]));
      const sequence = optimized.orderedStopIds.map((id) => byCustomer.get(id));
      if (
        sequence.length !== ordered.length ||
        sequence.some((s) => !s) ||
        new Set(optimized.orderedStopIds).size !== ordered.length
      ) {
        throw new Error("Routing provider returned an inconsistent stop order");
      }
      ordered = sequence as PlannedStop[];
      route = optimized;
    }
  } catch (error) {
    if (error instanceof RoutingError && error.code === "TOO_MANY_STOPS") {
      return fail("too_many_stops", warnings, { maxStops: MAX_STOPS });
    }
    throw error;
  }
  const expectedLegs = ordered.length === 0 ? 0 : ordered.length + 1;
  if (route.legs.length !== expectedLegs) {
    throw new Error(
      `Routing provider returned ${route.legs.length} legs, expected ${expectedLegs}`,
    );
  }

  const legs = route.legs.map((l) => ({
    distanceM: Math.round(l.distanceM),
    durationS: Math.round(l.durationS),
  }));
  const schedule = computeSchedule({
    departure: departureInstant(date, settings.departureTime, settings.timezone),
    legDurationsS: legs.map((l) => l.durationS),
    serviceSecondsPerStop: serviceSeconds,
  });
  const optimizedAt = now;
  const tourData = {
    status: "OPTIMIZED" as const,
    isOutdated: false,
    depotSnapshot: { name: depot.name, address: depot.address, lat: depot.lat, lng: depot.lng },
    geometry: route.geometry,
    totalDistanceM: Math.round(legs.reduce((sum, l) => sum + l.distanceM, 0)),
    totalDurationS: schedule.totalDurationS,
    approximate: route.approximate,
    optimizedAt,
  };

  return db.$transaction(
    async (tx): Promise<GenerateTourResult> => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`tour:${date.toISOString().slice(0, 10)}`}))`;
      // Orders or the tour changed while we were routing: the result would be stale.
      const newest = await tx.tour.findFirst({
        where: { date },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { id: true, updatedAt: true },
      });
      const currentOrders = await listConfirmedOrdersForDate(tx, date, {
        tourId: existing?.id ?? null,
      });
      if (
        newest?.id !== latest?.id ||
        newest?.updatedAt.getTime() !== latest?.updatedAt.getTime() ||
        orderSignature(currentOrders) !== signature
      ) {
        return fail("conflict", warnings);
      }

      const tourId = existing
        ? (await tx.tour.update({ where: { id: existing.id }, data: tourData })).id
        : (await tx.tour.create({ data: { date, ...tourData } })).id;

      // Existing stop rows are reused per customer (stable ids), the rest are created / removed.
      const stopByCustomer = new Map((existing?.stops ?? []).map((s) => [s.customerId, s.id]));
      const keep = new Set(ordered.map((s) => s.customerId));
      const stale = (existing?.stops ?? []).filter((s) => !keep.has(s.customerId)).map((s) => s.id);
      if (stale.length > 0) await tx.stop.deleteMany({ where: { id: { in: stale } } });

      for (const [index, stop] of ordered.entries()) {
        const data = {
          sequence: index + 1,
          etaAt: schedule.etas[index],
          legDistanceM: legs[index].distanceM,
          legDurationS: legs[index].durationS,
          // What the office releases for this stop; the driver sees this snapshot (NUD-043).
          items: stop.items.map((i) => ({
            productId: i.productId,
            quantity: i.quantity,
          })),
        };
        const orderLinks = stop.orderIds.map((orderId) => ({ orderId }));
        const stopId = stopByCustomer.get(stop.customerId);
        if (stopId) {
          await tx.stop.update({
            where: { id: stopId },
            data: { ...data, orders: { deleteMany: {}, create: orderLinks } },
          });
        } else {
          await tx.stop.create({
            data: { ...data, tourId, customerId: stop.customerId, orders: { create: orderLinks } },
          });
        }
      }

      const mode = followUp
        ? "follow_up"
        : !existing
          ? "created"
          : locked
            ? "locked_extended"
            : "replaced";
      await recordAudit(tx, {
        actorId: deps.actorId,
        entity: "Tour",
        entityId: tourId,
        action: followUp ? "tour.followup" : existing ? "tour.reoptimize" : "tour.generate",
        diff: {
          date: date.toISOString().slice(0, 10),
          mode,
          // Follow-up tour (NUD-099): the completed tours it comes after and the late orders in it.
          ...(followUp
            ? {
                followUpOfTourIds: dayTours.map((t) => t.id),
                orderIds: ordered.flatMap((s) => s.orderIds),
              }
            : {}),
          stopCountBefore: existing ? existing.stops.length : null,
          stopCount: ordered.length,
          addedCustomerIds: added,
          removedCustomerIds: removed,
          customerIds: ordered.map((s) => s.customerId),
          approximate: route.approximate,
          unroutedCustomerIds: warnings.map((w) => w.customerId),
        },
      });

      return {
        ok: true,
        tourId,
        mode,
        stopCount: ordered.length,
        addedCustomerIds: added,
        removedCustomerIds: removed,
        approximate: route.approximate,
        warnings,
      };
    },
    { timeout: 20_000, maxWait: 10_000 },
  );
}

function realDeps(actorId: string): TourBuilderDeps {
  return {
    db: getDb(),
    actorId,
    provider: getRoutingProvider(),
    requireDepot: requireDepotConfigured,
    loadSettings: getSettings,
  };
}

/** Application entry (callers: `generateTourAction`): real database, settings and provider. */
export async function generateTour(actorId: string, date: unknown): Promise<GenerateTourResult> {
  return generateTourWith(realDeps(actorId), date);
}

/**
 * Application entry of `createFollowUpTourAction` (NUD-099): a new tour for the confirmed orders
 * of a day that no stop contains, allowed only while every tour of the day is COMPLETED.
 */
export async function generateFollowUpTour(
  actorId: string,
  date: unknown,
): Promise<GenerateTourResult> {
  return generateTourWith(realDeps(actorId), date, { followUp: true });
}
