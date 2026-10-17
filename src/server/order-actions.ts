"use server";

import { requireRole } from "./auth/guards";
import { getDb } from "./db";
import {
  countConfirmedOrders,
  createOrder,
  getScreenshotPreviewUrl,
  type OrderSaveResult,
  todayIn,
} from "./orders";
import { getFactoryTimezone } from "./settings";
import { getStorage } from "./storage";

/**
 * Admin-only server actions for order entry. The role is checked against the database before
 * the input is read; everything else is validated again in `createOrder`.
 */

export async function createOrderAction(input: unknown): Promise<OrderSaveResult> {
  const actor = await requireRole("ADMIN");
  return createOrder(getDb(), actor.id, input, todayIn(await getFactoryTimezone()), getStorage());
}

/** Live warning while typing: confirmed orders the customer already has for that day. */
export async function confirmedOrderCountAction(
  customerId: unknown,
  deliveryDate: unknown,
): Promise<number> {
  await requireRole("ADMIN");
  return countConfirmedOrders(getDb(), customerId, deliveryDate);
}

/** Signed URL to show a freshly uploaded screenshot next to the form (`null` if it is not one). */
export async function screenshotPreviewUrlAction(storageKey: unknown): Promise<string | null> {
  await requireRole("ADMIN");
  return getScreenshotPreviewUrl(getStorage(), storageKey);
}
