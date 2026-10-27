import {
  isInsideWindow,
  type OrderWindow,
  pickPlannedDay,
  type PlannedDayReason,
} from "@/domain/delivery-window";
import { orderWeightKg } from "@/domain/weight";
import type { PrismaClient } from "@/generated/prisma/client";

/** Delivery weekdays when no settings row exists (Monday to Friday, like the column default). */
const DEFAULT_WEEKDAYS = [1, 2, 3, 4, 5];

export type PlannedDayDb = Pick<PrismaClient, "settings" | "vehicle" | "order" | "product">;

export type PlannedDayWarning = PlannedDayReason | "outside_window";

export type PlannedDay = { day: Date; warnings: Exclude<PlannedDayWarning, "ok">[] };

/**
 * The planned delivery day of an order (NUD-148, D25). With an explicit `requested` day (the
 * office moved it) that day is used and `outside_window` is reported when it lies outside the
 * window. Otherwise: the earliest day of the window that is a delivery weekday and still has
 * capacity for the order (sum of the active vehicles' kg minus the confirmed orders of that day;
 * `excludeOrderId` leaves the order being edited out of the load).
 */
export async function resolvePlannedDay(
  db: PlannedDayDb,
  input: {
    window: OrderWindow;
    requested: Date | null;
    items: readonly { productId: string; quantity: number }[];
    today: Date;
    excludeOrderId?: string;
  },
): Promise<PlannedDay> {
  if (input.requested) {
    return {
      day: input.requested,
      warnings: isInsideWindow(input.requested, input.window) ? [] : ["outside_window"],
    };
  }
  const settings = await db.settings.findUnique({
    where: { id: 1 },
    select: { deliveryWeekdays: true },
  });
  const vehicles = await db.vehicle.findMany({
    where: { active: true },
    select: { capacityKg: true },
  });
  const capacityKg = vehicles.length > 0 ? vehicles.reduce((s, v) => s + v.capacityKg, 0) : null;

  const products = (await db.product.findMany({ select: { id: true, weightKgPerUnit: true } })).map(
    (p) => ({ id: p.id, weightKgPerUnit: p.weightKgPerUnit.toString() }),
  );
  const orderKg = orderWeightKg(input.items, products);

  const usedKgByDay = new Map<string, number>();
  if (capacityKg !== null) {
    const orders = await db.order.findMany({
      where: {
        status: "CONFIRMED",
        deliveryDate: { gte: input.window.from, lte: input.window.to },
        ...(input.excludeOrderId ? { id: { not: input.excludeOrderId } } : {}),
      },
      select: { deliveryDate: true, items: { select: { productId: true, quantity: true } } },
    });
    for (const o of orders) {
      const key = o.deliveryDate.toISOString().slice(0, 10);
      usedKgByDay.set(key, (usedKgByDay.get(key) ?? 0) + orderWeightKg(o.items, products));
    }
  }
  const picked = pickPlannedDay({
    window: input.window,
    today: input.today,
    deliveryWeekdays: settings?.deliveryWeekdays ?? DEFAULT_WEEKDAYS,
    orderKg,
    usedKgByDay,
    capacityKg,
  });
  return { day: picked.day, warnings: picked.reason === "ok" ? [] : [picked.reason] };
}
