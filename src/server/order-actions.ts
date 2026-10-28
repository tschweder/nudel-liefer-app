"use server";

import { z } from "zod";

import { formatCalendarDate } from "@/domain/order";
import { MAX_SOURCE_TEXT } from "@/domain/order-extraction-answer";
import { isScreenshotKey } from "@/lib/uploads";

import { requireRole } from "./auth/guards";
import { getDb } from "./db";
import { extractOrderDraft, type OrderDraftOutcome } from "./order-extraction";
import { getOrderExtractor } from "./order-extractor";
import {
  cancelOrder,
  countConfirmedOrders,
  createOrder,
  duplicateOrder,
  getScreenshotPreviewUrl,
  isDayTourCompleted,
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
  const actor = await requireRole("ADMIN");
  return updateOrder(
    getDb(),
    actor.id,
    id,
    input,
    todayIn(await getFactoryTimezone()),
    getTourService(),
  );
}

/** Cancels an open order (status CANCELLED, never deleted). */
export async function cancelOrderAction(id: unknown): Promise<OrderCancelResult> {
  const actor = await requireRole("ADMIN");
  return cancelOrder(getDb(), actor.id, id, todayIn(await getFactoryTimezone()), getTourService());
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

/** Live warning while typing: every tour of that delivery day is already completed (NUD-116). */
export async function dayTourCompletedAction(deliveryDate: unknown): Promise<boolean> {
  await requireRole("ADMIN");
  return isDayTourCompleted(getDb(), deliveryDate);
}

/** Signed URL to show a freshly uploaded screenshot next to the form (`null` if it is not one). */
export async function screenshotPreviewUrlAction(storageKey: unknown): Promise<string | null> {
  await requireRole("ADMIN");
  return getScreenshotPreviewUrl(getStorage(), storageKey);
}

/** Input of the AI draft (NUD-150): a pasted customer message and/or an uploaded screenshot. */
const extractDraftInputSchema = z.object({
  text: z.string().max(MAX_SOURCE_TEXT).nullish(),
  screenshotKey: z.string().max(200).refine(isScreenshotKey).nullish(),
});

/**
 * Reads a pasted customer message and/or the attached screenshot into a DRAFT order (NUD-150, D26).
 * Read-only: the model's answer is returned to the form, and only saving the order stores anything
 * (the text as `Order.sourceText`, the raw answer as `Order.aiExtraction`).
 */
export async function extractOrderDraftAction(input: unknown): Promise<OrderDraftOutcome> {
  await requireRole("ADMIN");
  const parsed = extractDraftInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const timezone = await getFactoryTimezone();
  return extractOrderDraft(getDb(), parsed.data, {
    storage: getStorage(),
    extractor: getOrderExtractor(),
    today: formatCalendarDate(todayIn(timezone)),
    timezone,
  });
}
