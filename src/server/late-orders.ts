import {
  canCreateFollowUp,
  correctionCandidates,
  type DeliveredStopConflict,
  deliveredStopConflicts,
  findLateOrderIds,
  isOpenTour,
} from "@/domain/day-tours";
import { routingPoint } from "@/domain/parking";
import type { StopItem } from "@/domain/tour";
import type { PrismaClient } from "@/generated/prisma/client";

import { customerLocationSelect } from "./routing-points";
import type { DiffStopView } from "./tour-rerelease";
import { readStopItems } from "./tour-rerelease";

/**
 * Late orders (NUD-099): a CONFIRMED order for a day whose tour(s) are all COMPLETED is on no
 * stop, a completed tour is never flagged outdated or re-released, and `generateTour` refuses it.
 * Nothing would tell the office, so this read model finds them (unlinked orders, see
 * `findLateOrderIds`) and the planning page offers a follow-up tour for them.
 *
 * NUD-117 adds the delivered-stop conflicts as a second, actionable case: an order that was
 * increased after its stop was delivered can be handed to a follow-up delivery ("correction") with
 * one action. The conflicts stay reported either way — the completed stop was under-delivered.
 *
 * Admin reads only: the callers (`tourPlanQuery`, `orderOverviewQuery`, `todayProgressQuery`) check
 * the role, and so does the correction service (`correction-delivery.ts`).
 */

type Db = Pick<PrismaClient, "tour" | "stop" | "order" | "customer" | "product">;

const customerSelect = customerLocationSelect;

export type LateOrderView = DiffStopView & {
  orderIds: string[];
  /** False while the customer has no location at all: a follow-up tour cannot include the stop. */
  routable: boolean;
};

export type LateOrdersView = {
  /** Number of late orders (not customers). */
  lateOrderCount: number;
  /** The late orders merged per customer, with the quantities the follow-up stop would carry. */
  lateOrders: LateOrderView[];
  /**
   * Stops of completed tours whose orders were edited or cancelled after the tour ran
   * (`before` = delivered, `after` = now). The follow-up tour does not carry the difference by
   * itself; see `corrections`.
   */
  conflicts: DiffStopView[];
  /**
   * NUD-117: the increases among `conflicts` that can still be delivered — one entry per customer
   * with the difference (`before` = 0, `after` = the increase). Empty when nothing is deliverable:
   * a decrease can never be, and neither can an increase that is already planned elsewhere.
   */
  corrections: DiffStopView[];
  /** A conflict has an increase, but `corrections` is empty: explained in the UI. */
  correctionBlocked: boolean;
  /** All tours of the day are COMPLETED and at least one late order has a routable customer. */
  canCreateFollowUp: boolean;
  /** All tours of the day are COMPLETED and at least one delivered stop has a deliverable increase. */
  canCreateCorrection: boolean;
};

export const NO_LATE_ORDERS: LateOrdersView = {
  lateOrderCount: 0,
  lateOrders: [],
  conflicts: [],
  corrections: [],
  correctionBlocked: false,
  canCreateFollowUp: false,
  canCreateCorrection: false,
};

/** One CONFIRMED order of the day, as the day read models need it. */
export type DayOrder = {
  id: string;
  customerId: string;
  deliveryDate: Date;
  windowFrom: Date;
  windowTo: Date;
  windowFromTime: string | null;
  windowToTime: string | null;
  createdAt: Date;
  items: StopItem[];
  /** On a stop of one of the day's tours. */
  linkedToStop: boolean;
};

/** One stop of the day with the tour it belongs to. */
export type DayStop = {
  id: string;
  customerId: string;
  tourId: string;
  tourStatus: string;
  items: StopItem[];
  orderIds: string[];
};

/** Everything the late-order and correction rules look at, read once per day. */
export type DayDeliveryData = {
  tours: Array<{ id: string; status: string }>;
  orders: DayOrder[];
  stops: DayStop[];
};

/** The confirmed orders, their stop links and the stops of every tour of one delivery day. */
export async function loadDayDeliveryData(db: Db, date: Date): Promise<DayDeliveryData> {
  const tours = await db.tour.findMany({
    where: { date },
    select: { id: true, status: true },
  });
  if (tours.length === 0) return { tours, orders: [], stops: [] };
  const orders = await db.order.findMany({
    where: { deliveryDate: date, status: "CONFIRMED" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: { items: { orderBy: { id: "asc" } }, stopOrders: { select: { stopId: true } } },
  });
  const stops = await db.stop.findMany({
    where: { tour: { date } },
    orderBy: [{ tourId: "asc" }, { sequence: "asc" }],
    select: {
      id: true,
      customerId: true,
      tourId: true,
      items: true,
      tour: { select: { status: true } },
      orders: { select: { orderId: true } },
    },
  });
  return {
    tours,
    orders: orders.map((o) => ({
      id: o.id,
      customerId: o.customerId,
      deliveryDate: o.deliveryDate,
      windowFrom: o.windowFrom,
      windowTo: o.windowTo,
      windowFromTime: o.windowFromTime,
      windowToTime: o.windowToTime,
      createdAt: o.createdAt,
      items: o.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
      linkedToStop: o.stopOrders.length > 0,
    })),
    stops: stops.map((s) => ({
      id: s.id,
      customerId: s.customerId,
      tourId: s.tourId,
      tourStatus: s.tour.status,
      items: readStopItems(s.items),
      orderIds: s.orders.map((o) => o.orderId),
    })),
  };
}

/**
 * The delivered-stop conflicts of a day: stops of COMPLETED tours whose linked orders were edited
 * or cancelled afterwards. Only the orders linked to those stops count (a cancelled one is missing,
 * which is the point); pure mapping over the already loaded data.
 */
export function deliveredConflictsOf(data: DayDeliveryData): DeliveredStopConflict[] {
  const orderById = new Map(data.orders.map((o) => [o.id, o]));
  const completed = data.stops.filter((s) => s.tourStatus === "COMPLETED");
  return deliveredStopConflicts(
    completed.map((s) => ({
      id: s.id,
      customerId: s.customerId,
      orderIds: s.orderIds,
      items: s.items,
    })),
    completed.flatMap((s) =>
      s.orderIds.flatMap((orderId) => {
        const order = orderById.get(orderId);
        return order ? [{ id: order.id, customerId: order.customerId, items: order.items }] : [];
      }),
    ),
  );
}

export async function getLateOrdersView(db: Db, date: Date): Promise<LateOrdersView> {
  const data = await loadDayDeliveryData(db, date);
  if (data.tours.length === 0) return NO_LATE_ORDERS;

  const lateIds = new Set(
    findLateOrderIds(
      data.tours,
      data.orders.map((o) => ({ id: o.id, linkedToTour: o.linkedToStop })),
    ),
  );
  const conflicts = deliveredConflictsOf(data);
  const corrections = correctionCandidates(conflicts, data.stops, data.orders);
  const lateOrders = data.orders.filter((o) => lateIds.has(o.id));
  if (lateOrders.length === 0 && conflicts.length === 0) return NO_LATE_ORDERS;

  const customerIds = [
    ...new Set([...lateOrders.map((o) => o.customerId), ...conflicts.map((c) => c.customerId)]),
  ];
  const customers = new Map(
    (
      await db.customer.findMany({ where: { id: { in: customerIds } }, select: customerSelect })
    ).map((c) => [c.id, c]),
  );
  const productIds = new Set([
    ...lateOrders.flatMap((o) => o.items.map((i) => i.productId)),
    ...conflicts.flatMap((c) => c.items.map((i) => i.productId)),
  ]);
  const products = new Map(
    (
      await db.product.findMany({
        where: { id: { in: [...productIds] } },
        select: { id: true, sku: true, name: true, unit: true },
      })
    ).map((p) => [p.id, p]),
  );
  const line = (productId: string, before: number, after: number) => ({
    productId,
    before,
    after,
    sku: products.get(productId)?.sku ?? "",
    name: products.get(productId)?.name ?? null,
    unit: products.get(productId)?.unit ?? "PACK",
  });
  const stopView = (customerId: string, stopId: string | null, items: DiffStopView["items"]) => {
    const customer = customers.get(customerId);
    return {
      stopId,
      customerId,
      customerNumber: customer?.customerNumber ?? "",
      name: customer?.name ?? "",
      items,
    };
  };

  // One entry per customer, quantities merged.
  const perCustomer = new Map<string, LateOrderView>();
  for (const order of lateOrders) {
    const c = customers.get(order.customerId);
    let entry = perCustomer.get(order.customerId);
    if (!entry) {
      entry = {
        stopId: null,
        customerId: order.customerId,
        customerNumber: c?.customerNumber ?? "",
        name: c?.name ?? "",
        items: [],
        orderIds: [],
        routable: !!c && routingPoint(c) !== null,
      };
      perCustomer.set(order.customerId, entry);
    }
    entry.orderIds.push(order.id);
    for (const item of order.items) {
      const added = item.quantity;
      const existing = entry.items.find((i) => i.productId === item.productId);
      if (existing) existing.after += added;
      else entry.items.push(line(item.productId, 0, added));
    }
  }
  const lateViews = [...perCustomer.values()];
  const dayCompleted = data.tours.length > 0 && data.tours.every((t) => !isOpenTour(t.status));

  return {
    lateOrderCount: lateOrders.length,
    lateOrders: lateViews,
    conflicts: conflicts.map((c) =>
      stopView(
        c.customerId,
        c.stopId,
        c.items.map((i) => line(i.productId, i.before, i.after)),
      ),
    ),
    corrections: corrections.map((c) =>
      stopView(
        c.customerId,
        c.stopId,
        c.items.map((i) => line(i.productId, 0, i.quantity)),
      ),
    ),
    correctionBlocked:
      corrections.length === 0 && conflicts.some((c) => c.items.some((i) => i.after > i.before)),
    canCreateFollowUp: canCreateFollowUp(data.tours, lateViews.filter((v) => v.routable).length),
    canCreateCorrection: dayCompleted && corrections.length > 0,
  };
}

/**
 * Which of these overview rows are late orders (CONFIRMED, on no stop, every tour of their day
 * COMPLETED). One query for the tours of all days involved.
 */
export async function lateOrderIdsForRows(
  db: Pick<PrismaClient, "tour">,
  rows: ReadonlyArray<{
    id: string;
    deliveryDate: Date;
    status: string;
    tour: { tourId: string } | null;
  }>,
): Promise<Set<string>> {
  const candidates = rows.filter((r) => r.status === "CONFIRMED" && r.tour === null);
  if (candidates.length === 0) return new Set();
  const dates = [
    ...new Map(candidates.map((r) => [r.deliveryDate.getTime(), r.deliveryDate])).values(),
  ];

  const tours = await db.tour.findMany({
    where: { date: { in: dates } },
    select: { date: true, status: true },
  });
  const late = new Set<string>();
  for (const date of dates) {
    const dayTours = tours.filter((t) => t.date.getTime() === date.getTime());
    const ids = findLateOrderIds(
      dayTours,
      candidates
        .filter((r) => r.deliveryDate.getTime() === date.getTime())
        .map((r) => ({ id: r.id, linkedToTour: false })),
    );
    ids.forEach((id) => late.add(id));
  }
  return late;
}
