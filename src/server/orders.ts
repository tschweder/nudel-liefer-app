import { z } from "zod";

import {
  centsToDecimal,
  isPastDeliveryDate,
  orderInputSchema,
  parseCalendarDate,
} from "@/domain/order";
import { calendarDayIn } from "@/domain/settings";
import type { PrismaClient } from "@/generated/prisma/client";
import { isScreenshotKey, MAX_UPLOAD_BYTES } from "@/lib/uploads";

import type { Storage } from "./storage/types";

type OrderDb = Pick<PrismaClient, "order" | "customer" | "product" | "screenshot">;

export type OrderSaveResult =
  | { ok: true; id: string; status: "CONFIRMED" | "DRAFT" }
  | {
      ok: false;
      error:
        | "invalid"
        | "date_in_past"
        | "customer_not_found"
        | "customer_inactive"
        | "product_not_found"
        | "product_inactive"
        | "screenshot_missing"
        | "screenshot_in_use";
    };

const idSchema = z.string().trim().min(1).max(64);

/** The factory-time-zone calendar day of `now` as a `DATE` value (UTC midnight). */
export function todayIn(timezone: string, now: Date = new Date()): Date {
  const { y, m, d } = calendarDayIn(now, timezone);
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * Creates an order (status CONFIRMED or DRAFT) with its items in one statement. Source is MANUAL,
 * or SCREENSHOT when a screenshot is attached (NUD-031): the key must be one the upload endpoint
 * issues (`screenshots/<uuid>.<ext>`), the object must really exist in storage and the key may be
 * attached only once; then a `Screenshot` row is created together with the order. The caller checked the role. Validation is repeated here because the client is
 * never trusted: quantities > 0, at least one line, same product merged, customer and products
 * must exist and be active (archived customers / inactive products are not accepted), and the
 * delivery day must not lie in the past.
 */
export async function createOrder(
  db: OrderDb,
  actorId: string,
  rawInput: unknown,
  today: Date,
  storage: Pick<Storage, "head">,
): Promise<OrderSaveResult> {
  const parsed = orderInputSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;
  if (isPastDeliveryDate(v.deliveryDate, today)) return { ok: false, error: "date_in_past" };

  const customer = await db.customer.findUnique({
    where: { id: v.customerId },
    select: { active: true },
  });
  if (!customer) return { ok: false, error: "customer_not_found" };
  if (!customer.active) return { ok: false, error: "customer_inactive" };

  const products = await db.product.findMany({
    where: { id: { in: v.lines.map((l) => l.productId) } },
    select: { id: true, active: true },
  });
  if (products.length !== v.lines.length) return { ok: false, error: "product_not_found" };
  if (products.some((p) => !p.active)) return { ok: false, error: "product_inactive" };

  if (v.screenshotKey) {
    const stored = await storage.head(v.screenshotKey);
    if (!stored) return { ok: false, error: "screenshot_missing" };
    if (stored.bytes <= 0 || stored.bytes > MAX_UPLOAD_BYTES)
      return { ok: false, error: "invalid" };
    const used = await db.screenshot.findFirst({
      where: { storageKey: v.screenshotKey },
      select: { id: true },
    });
    if (used) return { ok: false, error: "screenshot_in_use" };
  }

  const order = await db.order.create({
    data: {
      customer: { connect: { id: v.customerId } },
      deliveryDate: v.deliveryDate,
      status: v.status,
      source: v.screenshotKey ? "SCREENSHOT" : "MANUAL",
      screenshot: v.screenshotKey
        ? { create: { storageKey: v.screenshotKey, uploadedById: actorId } }
        : undefined,
      internalNote: v.internalNote,
      createdBy: { connect: { id: actorId } },
      items: {
        create: v.lines.map((l) => ({
          productId: l.productId,
          quantity: centsToDecimal(l.quantityCents),
        })),
      },
    },
    select: { id: true },
  });
  return { ok: true, id: order.id, status: v.status };
}

export type OrderableCustomer = {
  id: string;
  customerNumber: string;
  name: string;
  street: string;
  postalCode: string;
  city: string;
  pinConfirmed: boolean;
};

/** Customers that may receive new orders: active ones only (archived customers are never offered). */
export async function listOrderableCustomers(
  db: Pick<PrismaClient, "customer">,
): Promise<OrderableCustomer[]> {
  return db.customer.findMany({
    where: { active: true },
    orderBy: [{ name: "asc" }, { customerNumber: "asc" }],
    select: {
      id: true,
      customerNumber: true,
      name: true,
      street: true,
      postalCode: true,
      city: true,
      pinConfirmed: true,
    },
  });
}

/** How many CONFIRMED orders the customer already has for that day (they merge into one stop). */
export async function countConfirmedOrders(
  db: Pick<PrismaClient, "order">,
  rawCustomerId: unknown,
  rawDate: unknown,
): Promise<number> {
  const customerId = idSchema.safeParse(rawCustomerId);
  const date = typeof rawDate === "string" ? parseCalendarDate(rawDate.trim()) : null;
  if (!customerId.success || !date) return 0;
  return db.order.count({
    where: { customerId: customerId.data, deliveryDate: date, status: "CONFIRMED" },
  });
}

export type OrderOverviewRow = {
  id: string;
  /** `DATE` value as UTC midnight. */
  deliveryDate: Date;
  status: "DRAFT" | "CONFIRMED" | "CANCELLED";
  source: "MANUAL" | "SCREENSHOT";
  customer: { id: string; customerNumber: string; name: string };
  items: Array<{ id: string; productName: unknown; unit: string; quantity: string }>;
};

const OVERVIEW_LIMIT = 200;

/**
 * Minimal order list (placeholder until NUD-032): orders from `today` on, oldest day first.
 * Cancelled orders are shown (with their status) because there is no filter yet.
 */
export async function listOrderOverview(
  db: Pick<PrismaClient, "order">,
  today: Date,
): Promise<OrderOverviewRow[]> {
  const rows = await db.order.findMany({
    where: { deliveryDate: { gte: today } },
    orderBy: [{ deliveryDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    take: OVERVIEW_LIMIT,
    include: {
      customer: { select: { id: true, customerNumber: true, name: true } },
      items: {
        include: { product: { select: { name: true, unit: true } } },
        orderBy: { id: "asc" },
      },
    },
  });
  return rows.map((o) => ({
    id: o.id,
    deliveryDate: o.deliveryDate,
    status: o.status,
    source: o.source,
    customer: o.customer,
    items: o.items.map((i) => ({
      id: i.id,
      productName: i.product.name,
      unit: i.product.unit,
      quantity: i.quantity.toString(),
    })),
  }));
}

export type OrderDetail = {
  id: string;
  /** `DATE` value as UTC midnight. */
  deliveryDate: Date;
  status: "DRAFT" | "CONFIRMED" | "CANCELLED";
  source: "MANUAL" | "SCREENSHOT";
  internalNote: string | null;
  createdAt: Date;
  createdBy: { displayName: string };
  customer: { id: string; customerNumber: string; name: string };
  items: Array<{ id: string; productName: unknown; unit: string; quantity: string }>;
  /** Attached screenshot with a signed, short-lived read URL (the bucket stays private). */
  screenshot: { id: string; url: string } | null;
};

/**
 * Read-only order detail (NUD-031; NUD-032 extends it with editing). Returns `null` for an
 * unknown id. The screenshot URL is signed on the server for each request.
 */
export async function getOrderDetail(
  db: Pick<PrismaClient, "order">,
  storage: Pick<Storage, "getReadUrl">,
  rawId: unknown,
): Promise<OrderDetail | null> {
  const id = idSchema.safeParse(rawId);
  if (!id.success) return null;
  const o = await db.order.findUnique({
    where: { id: id.data },
    include: {
      customer: { select: { id: true, customerNumber: true, name: true } },
      createdBy: { select: { displayName: true } },
      screenshot: { select: { id: true, storageKey: true } },
      items: {
        include: { product: { select: { name: true, unit: true } } },
        orderBy: { id: "asc" },
      },
    },
  });
  if (!o) return null;
  return {
    id: o.id,
    deliveryDate: o.deliveryDate,
    status: o.status,
    source: o.source,
    internalNote: o.internalNote,
    createdAt: o.createdAt,
    createdBy: o.createdBy,
    customer: o.customer,
    items: o.items.map((i) => ({
      id: i.id,
      productName: i.product.name,
      unit: i.product.unit,
      quantity: i.quantity.toString(),
    })),
    screenshot: o.screenshot
      ? { id: o.screenshot.id, url: await storage.getReadUrl(o.screenshot.storageKey) }
      : null,
  };
}

/**
 * Signed preview URL for a just-uploaded screenshot, shown in the split view before the order is
 * saved. Only keys of the screenshot namespace whose object exists are signed.
 */
export async function getScreenshotPreviewUrl(
  storage: Pick<Storage, "head" | "getReadUrl">,
  rawKey: unknown,
): Promise<string | null> {
  const key = typeof rawKey === "string" && rawKey.length <= 200 ? rawKey : "";
  if (!isScreenshotKey(key)) return null;
  if (!(await storage.head(key))) return null;
  return storage.getReadUrl(key);
}
