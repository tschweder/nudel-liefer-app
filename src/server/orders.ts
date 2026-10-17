import { z } from "zod";

import {
  centsToDecimal,
  isPastDeliveryDate,
  orderInputSchema,
  parseCalendarDate,
} from "@/domain/order";
import { calendarDayIn } from "@/domain/settings";
import type { PrismaClient } from "@/generated/prisma/client";

type OrderDb = Pick<PrismaClient, "order" | "customer" | "product">;

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
        | "product_inactive";
    };

const idSchema = z.string().trim().min(1).max(64);

/** The factory-time-zone calendar day of `now` as a `DATE` value (UTC midnight). */
export function todayIn(timezone: string, now: Date = new Date()): Date {
  const { y, m, d } = calendarDayIn(now, timezone);
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * Creates a manual order (source MANUAL, status CONFIRMED or DRAFT) with its items in one
 * statement. The caller checked the role. Validation is repeated here because the client is
 * never trusted: quantities > 0, at least one line, same product merged, customer and products
 * must exist and be active (archived customers / inactive products are not accepted), and the
 * delivery day must not lie in the past.
 */
export async function createOrder(
  db: OrderDb,
  actorId: string,
  rawInput: unknown,
  today: Date,
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

  const order = await db.order.create({
    data: {
      customerId: v.customerId,
      deliveryDate: v.deliveryDate,
      status: v.status,
      source: "MANUAL",
      internalNote: v.internalNote,
      createdById: actorId,
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
