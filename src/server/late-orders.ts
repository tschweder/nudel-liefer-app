import { canCreateFollowUp, deliveredStopConflicts, findLateOrderIds } from "@/domain/day-tours";
import { hasConfirmedPin } from "@/domain/tour";
import type { PrismaClient } from "@/generated/prisma/client";

import type { DiffStopView } from "./tour-rerelease";
import { readStopItems } from "./tour-rerelease";

/**
 * Late orders (NUD-099): a CONFIRMED order for a day whose tour(s) are all COMPLETED is on no
 * stop, a completed tour is never flagged outdated or re-released, and `generateTour` refuses it.
 * Nothing would tell the office, so this read model finds them (unlinked orders, see
 * `findLateOrderIds`) and the planning page offers a follow-up tour for them. Admin reads only:
 * the callers (`tourPlanQuery`, `orderOverviewQuery`, `todayProgressQuery`) check the role.
 */

type Db = Pick<PrismaClient, "tour" | "stop" | "order" | "customer" | "product">;

export type LateOrderView = DiffStopView & {
  orderIds: string[];
  /** False while the customer has no confirmed pin: a follow-up tour cannot include the stop. */
  routable: boolean;
};

export type LateOrdersView = {
  /** Number of late orders (not customers). */
  lateOrderCount: number;
  /** The late orders merged per customer, with the quantities the follow-up stop would carry. */
  lateOrders: LateOrderView[];
  /**
   * Stops of completed tours whose orders were edited or cancelled after the tour ran
   * (`before` = delivered, `after` = now). The follow-up tour does not deliver the difference:
   * the office has to deal with it outside the tour.
   */
  conflicts: DiffStopView[];
  /** All tours of the day are COMPLETED and at least one late order has a routable customer. */
  canCreateFollowUp: boolean;
};

export const NO_LATE_ORDERS: LateOrdersView = {
  lateOrderCount: 0,
  lateOrders: [],
  conflicts: [],
  canCreateFollowUp: false,
};

const customerSelect = {
  id: true,
  customerNumber: true,
  name: true,
  lat: true,
  lng: true,
  pinConfirmed: true,
} as const;

export async function getLateOrdersView(db: Db, date: Date): Promise<LateOrdersView> {
  const tours = await db.tour.findMany({
    where: { date },
    select: { id: true, status: true },
  });
  if (tours.length === 0) return NO_LATE_ORDERS;

  const orders = await db.order.findMany({
    where: { deliveryDate: date, status: "CONFIRMED" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: { items: { orderBy: { id: "asc" } }, stopOrders: { select: { stopId: true } } },
  });
  const lateIds = new Set(
    findLateOrderIds(
      tours,
      orders.map((o) => ({ id: o.id, linkedToTour: o.stopOrders.length > 0 })),
    ),
  );

  // Stops of the completed tours: their linked orders must still match what was delivered.
  const completedStops = await db.stop.findMany({
    where: { tour: { date, status: "COMPLETED" } },
    select: { id: true, customerId: true, items: true, orders: { select: { orderId: true } } },
  });
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const conflicts = deliveredStopConflicts(
    completedStops.map((s) => ({
      id: s.id,
      customerId: s.customerId,
      orderIds: s.orders.map((o) => o.orderId),
      items: readStopItems(s.items),
    })),
    // Only the orders linked to those stops (a cancelled one is missing, which is the point).
    completedStops.flatMap((s) =>
      s.orders.flatMap((o) => {
        const order = orderById.get(o.orderId);
        return order ? [order] : [];
      }),
    ),
  );

  const lateOrders = orders.filter((o) => lateIds.has(o.id));
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
        routable: hasConfirmedPin(c),
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

  return {
    lateOrderCount: lateOrders.length,
    lateOrders: lateViews,
    conflicts: conflicts.map((c) => {
      const customer = customers.get(c.customerId);
      return {
        stopId: c.stopId,
        customerId: c.customerId,
        customerNumber: customer?.customerNumber ?? "",
        name: customer?.name ?? "",
        items: c.items.map((i) => line(i.productId, i.before, i.after)),
      };
    }),
    canCreateFollowUp: canCreateFollowUp(tours, lateViews.filter((v) => v.routable).length),
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
