"use server";

import { requireRole } from "./auth/guards";
import { getDb } from "./db";
import {
  cancelOrder,
  countConfirmedOrders,
  createOrder,
  duplicateOrder,
  getScreenshotPreviewUrl,
  type OrderCancelResult,
  type OrderDuplicateResult,
  type OrderSaveResult,
  type OrderUpdateResult,
  todayIn,
  updateOrder,
} from "./orders";
import { getFactoryTimezone } from "./settings";
import { getStorage } from "./storage";
import { getTourService } from "./tour-service";

/**
 * Admin-only server actions for order entry. The role is checked against the database before
 * the input is read; everything else is validated again in `createOrder`.
 */

export async function createOrderAction(input: unknown): Promise<OrderSaveResult> {
  const actor = await requireRole("ADMIN");
  return createOrder(
    getDb(),
    actor.id,
    input,
    todayIn(await getFactoryTimezone()),
    getStorage(),
    getTourService(),
  );
}

/** Edits an open order (date, status, note, lines); same validation as order entry. */
export async function updateOrderAction(id: unknown, input: unknown): Promise<OrderUpdateResult> {
  await requireRole("ADMIN");
  return updateOrder(getDb(), id, input, todayIn(await getFactoryTimezone()), getTourService());
}

/** Cancels an open order (status CANCELLED, never deleted). */
export async function cancelOrderAction(id: unknown): Promise<OrderCancelResult> {
  await requireRole("ADMIN");
  return cancelOrder(getDb(), id, todayIn(await getFactoryTimezone()), getTourService());
}

/** Copies an order to another delivery day as a new draft. */
export async function duplicateOrderAction(
  id: unknown,
  deliveryDate: unknown,
): Promise<OrderDuplicateResult> {
  const actor = await requireRole("ADMIN");
  return duplicateOrder(
    getDb(),
    actor.id,
    id,
    deliveryDate,
    todayIn(await getFactoryTimezone()),
    getTourService(),
  );
}

/** Live warning while typing: confirmed orders the customer already has for that day. */
export async function confirmedOrderCountAction(
  customerId: unknown,
  deliveryDate: unknown,
  excludeOrderId?: unknown,
): Promise<number> {
  await requireRole("ADMIN");
  return countConfirmedOrders(getDb(), customerId, deliveryDate, excludeOrderId);
}

/** Signed URL to show a freshly uploaded screenshot next to the form (`null` if it is not one). */
export async function screenshotPreviewUrlAction(storageKey: unknown): Promise<string | null> {
  await requireRole("ADMIN");
  return getScreenshotPreviewUrl(getStorage(), storageKey);
}
