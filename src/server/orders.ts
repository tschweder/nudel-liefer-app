import { z } from "zod";

import { diffOrderUpdate, type LineChange } from "@/domain/audit";
import {
  centsToDecimal,
  formatCalendarDate,
  isPastDeliveryDate,
  orderInputSchema,
  parseCalendarDate,
  parseQuantityCents,
} from "@/domain/order";
import {
  aggregateTotalsByDate,
  isOrderEditable,
  type OrderFilters,
  totalToDecimal,
} from "@/domain/order-overview";
import { calendarDayIn } from "@/domain/settings";
import { type OrderState, outdatedTourDates } from "@/domain/tour-diff";
import type { PrismaClient } from "@/generated/prisma/client";
import { isScreenshotKey, MAX_UPLOAD_BYTES } from "@/lib/uploads";

import { recordAudit } from "./audit";
import type { Storage } from "./storage/types";
import type { TourDb, TourService } from "./tour-service";

/** What the order mutations need from the tour side (see `tour-service.ts`). */
export type TourHook = Pick<TourService, "markOutdatedForDate">;

type OrderDb = Pick<
  PrismaClient,
  "order" | "customer" | "product" | "screenshot" | "auditLog" | "$transaction"
>;

/**
 * Flags the tours of every delivery day that a change from `before` to `after` affects, through
 * the transaction client of the order write (so both succeed or both fail). Draft edits and saves
 * that change nothing a tour contains flag nothing.
 */
async function flagAffectedTours(
  tours: TourHook,
  tx: TourDb,
  before: OrderState | null,
  after: OrderState | null,
): Promise<void> {
  for (const date of outdatedTourDates(before, after)) {
    await tours.markOutdatedForDate(date, tx);
  }
}

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
 * delivery day must not lie in the past. Afterwards the tours of that day are flagged outdated.
 */
export async function createOrder(
  db: OrderDb,
  actorId: string,
  rawInput: unknown,
  today: Date,
  storage: Pick<Storage, "head">,
  tours: TourHook,
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

  const order = await db.$transaction(async (tx) => {
    const created = await tx.order.create({
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
    await recordAudit(tx, {
      actorId,
      entity: "Order",
      entityId: created.id,
      action: "order.create",
      diff: {
        customerId: v.customerId,
        status: v.status,
        deliveryDate: formatCalendarDate(v.deliveryDate),
        source: v.screenshotKey ? "SCREENSHOT" : "MANUAL",
        internalNote: v.internalNote ?? null,
        lines: v.lines.map((l): LineChange => ({
          productId: l.productId,
          before: null,
          after: l.quantityCents,
        })),
      },
    });
    await flagAffectedTours(tours, tx, null, {
      status: v.status,
      customerId: v.customerId,
      deliveryDate: v.deliveryDate,
      items: v.lines.map((l) => ({
        productId: l.productId,
        quantity: centsToDecimal(l.quantityCents),
      })),
    });
    return created;
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
  rawExcludeOrderId?: unknown,
): Promise<number> {
  const customerId = idSchema.safeParse(rawCustomerId);
  const date = typeof rawDate === "string" ? parseCalendarDate(rawDate.trim()) : null;
  if (!customerId.success || !date) return 0;
  const exclude = idSchema.safeParse(rawExcludeOrderId);
  return db.order.count({
    where: {
      customerId: customerId.data,
      deliveryDate: date,
      status: "CONFIRMED",
      ...(exclude.success ? { id: { not: exclude.data } } : {}),
    },
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
  /** The tour this order is part of (through its stop), or `null` while no tour contains it. */
  tour: { tourId: string; stopId: string } | null;
  /**
   * Confirmed after the tour of that day was completed and on no stop (NUD-099). Set by
   * `orderOverviewQuery`, not by `listOrderOverview`.
   */
  late?: boolean;
};

export const OVERVIEW_LIMIT = 300;

/**
 * Orders matching the filters (date range inclusive, optional customer / status / source), oldest
 * day first. Cancelled orders are listed (with their status) unless a status filter says
 * otherwise. `truncated` is true when more than `OVERVIEW_LIMIT` orders match.
 */
export async function listOrderOverview(
  db: Pick<PrismaClient, "order">,
  filters: OrderFilters,
): Promise<{ rows: OrderOverviewRow[]; truncated: boolean }> {
  const from = parseCalendarDate(filters.from);
  const to = parseCalendarDate(filters.to);
  if (!from || !to) return { rows: [], truncated: false };
  const rows = await db.order.findMany({
    where: {
      deliveryDate: { gte: from, lte: to },
      ...(filters.customerId ? { customerId: filters.customerId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.source ? { source: filters.source } : {}),
    },
    orderBy: [{ deliveryDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    take: OVERVIEW_LIMIT + 1,
    include: {
      customer: { select: { id: true, customerNumber: true, name: true } },
      items: {
        include: { product: { select: { name: true, unit: true } } },
        orderBy: { id: "asc" },
      },
      stopOrders: { select: { stop: { select: { id: true, tourId: true } } }, take: 1 },
    },
  });
  return {
    truncated: rows.length > OVERVIEW_LIMIT,
    rows: rows.slice(0, OVERVIEW_LIMIT).map((o) => ({
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
      tour: o.stopOrders[0]
        ? { tourId: o.stopOrders[0].stop.tourId, stopId: o.stopOrders[0].stop.id }
        : null,
    })),
  };
}

export type DateTotalsView = {
  /** `YYYY-MM-DD` */
  date: string;
  orderCount: number;
  products: Array<{
    productId: string;
    productName: unknown;
    sku: string;
    unit: string;
    /** Exact sum as a plain decimal string, e.g. `"12.50"`. */
    quantity: string;
  }>;
};

/**
 * Totals panel: sum per product for every date in the range, from CONFIRMED orders only (via the
 * pure `aggregateTotalsByDate`). Deliberately independent of the customer / status / source
 * filters: it answers "what must be produced and loaded for that day".
 */
export async function getDateTotals(
  db: Pick<PrismaClient, "order">,
  filters: Pick<OrderFilters, "from" | "to">,
): Promise<DateTotalsView[]> {
  const from = parseCalendarDate(filters.from);
  const to = parseCalendarDate(filters.to);
  if (!from || !to) return [];
  const orders = await db.order.findMany({
    where: { deliveryDate: { gte: from, lte: to }, status: "CONFIRMED" },
    select: {
      deliveryDate: true,
      status: true,
      items: {
        select: {
          productId: true,
          quantity: true,
          product: { select: { name: true, sku: true, unit: true, sortOrder: true } },
        },
      },
    },
  });
  const products = new Map<
    string,
    { name: unknown; sku: string; unit: string; sortOrder: number }
  >();
  const parsed = orders.map((o) => ({
    deliveryDate: formatCalendarDate(o.deliveryDate),
    status: o.status,
    items: o.items.flatMap((i) => {
      products.set(i.productId, i.product);
      const cents = parseQuantityCents(i.quantity.toString());
      return cents === null ? [] : [{ productId: i.productId, quantityCents: cents }];
    }),
  }));
  return aggregateTotalsByDate(parsed).map((day) => ({
    date: day.date,
    orderCount: day.orderCount,
    products: day.products
      .map((p) => ({ ...p, info: products.get(p.productId) }))
      .filter((p): p is typeof p & { info: NonNullable<typeof p.info> } => Boolean(p.info))
      .sort((a, b) => a.info.sortOrder - b.info.sortOrder || a.info.sku.localeCompare(b.info.sku))
      .map((p) => ({
        productId: p.productId,
        productName: p.info.name,
        sku: p.info.sku,
        unit: p.info.unit,
        quantity: totalToDecimal(p.quantityCents),
      })),
  }));
}

/**
 * Which tour a read of the day's orders is for (NUD-099). A day normally has one tour, but after a
 * completed tour a follow-up tour can exist. Orders already on a stop of ANOTHER tour of that day
 * belong to that tour, so they must not be planned, diffed or counted again.
 * - `{ tourId: "x" }`: the orders for tour x = every order not on a stop of another tour.
 * - `{ tourId: null }`: the orders for a tour that does not exist yet = orders on no stop at all.
 */
export type TourOrderScope = { tourId: string | null };

/**
 * The CONFIRMED orders of one delivery day with their items: the only orders a tour may contain
 * (NUD-041 builds stops from this). Drafts and cancelled orders are never returned. Without
 * `scope` all of the day's confirmed orders are returned; tour code passes the scope of its tour.
 */
export async function listConfirmedOrdersForDate(
  db: Pick<PrismaClient, "order">,
  date: Date,
  scope?: TourOrderScope,
) {
  return db.order.findMany({
    where: {
      deliveryDate: date,
      status: "CONFIRMED",
      ...(scope
        ? {
            stopOrders: {
              none: {
                stop: {
                  tour: { date, ...(scope.tourId ? { id: { not: scope.tourId } } : {}) },
                },
              },
            },
          }
        : {}),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: { items: { orderBy: { id: "asc" } } },
  });
}

export type FilterCustomer = { id: string; customerNumber: string; name: string; city: string };

/** All customers (archived ones too: their old orders can still be filtered) for the filter. */
export async function listCustomersForFilter(
  db: Pick<PrismaClient, "customer">,
): Promise<FilterCustomer[]> {
  return db.customer.findMany({
    orderBy: [{ name: "asc" }, { customerNumber: "asc" }],
    select: { id: true, customerNumber: true, name: true, city: true },
  });
}

export type OrderDetail = {
  id: string;
  /** `DATE` value as UTC midnight. */
  deliveryDate: Date;
  status: "DRAFT" | "CONFIRMED" | "CANCELLED";
  source: "MANUAL" | "SCREENSHOT";
  internalNote: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: { displayName: string };
  customer: {
    id: string;
    customerNumber: string;
    name: string;
    city: string;
    pinConfirmed: boolean;
    active: boolean;
  };
  items: Array<{
    id: string;
    productId: string;
    sku: string;
    productName: unknown;
    unit: string;
    quantity: string;
  }>;
  /** Open order of today or a later day: it can be edited and cancelled. */
  editable: boolean;
  /** The tour this order is part of, if any. */
  tour: { tourId: string; stopId: string } | null;
  /** Attached screenshot with a signed, short-lived read URL (the bucket stays private). */
  screenshot: { id: string; url: string } | null;
};

/**
 * Order detail (NUD-031; NUD-032 adds `editable` and the tour link). Returns `null` for an
 * unknown id. The screenshot URL is signed on the server for each request.
 */
export async function getOrderDetail(
  db: Pick<PrismaClient, "order">,
  storage: Pick<Storage, "getReadUrl">,
  rawId: unknown,
  today: Date,
): Promise<OrderDetail | null> {
  const id = idSchema.safeParse(rawId);
  if (!id.success) return null;
  const o = await db.order.findUnique({
    where: { id: id.data },
    include: {
      customer: {
        select: {
          id: true,
          customerNumber: true,
          name: true,
          city: true,
          pinConfirmed: true,
          active: true,
        },
      },
      createdBy: { select: { displayName: true } },
      screenshot: { select: { id: true, storageKey: true } },
      items: {
        include: { product: { select: { name: true, unit: true, sku: true } } },
        orderBy: { id: "asc" },
      },
      stopOrders: { select: { stop: { select: { id: true, tourId: true } } }, take: 1 },
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
    updatedAt: o.updatedAt,
    createdBy: o.createdBy,
    customer: o.customer,
    items: o.items.map((i) => ({
      id: i.id,
      productId: i.productId,
      sku: i.product.sku,
      productName: i.product.name,
      unit: i.product.unit,
      quantity: i.quantity.toString(),
    })),
    editable: isOrderEditable(o, today),
    tour: o.stopOrders[0]
      ? { tourId: o.stopOrders[0].stop.tourId, stopId: o.stopOrders[0].stop.id }
      : null,
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

export type OrderMutationError =
  | "invalid"
  | "not_found"
  | "not_editable"
  | "date_in_past"
  | "customer_inactive"
  | "product_not_found"
  | "product_inactive";

export type OrderUpdateResult =
  | { ok: true; id: string; status: "CONFIRMED" | "DRAFT" }
  | { ok: false; error: OrderMutationError };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Edits an open order (status DRAFT / CONFIRMED, delivery day today or later): delivery date,
 * status, internal note and the lines. The customer and the screenshot never change here. The
 * input goes through exactly the same validation as order entry (`orderInputSchema`: quantities
 * > 0 with at most 2 decimals, at least one line, same product merged); the lines are replaced
 * in one statement. A product that was deactivated meanwhile may stay in the order, but cannot
 * be added. The tours of the old and of the new delivery day are flagged outdated.
 */
export async function updateOrder(
  db: OrderDb,
  actorId: string,
  rawId: unknown,
  rawInput: unknown,
  today: Date,
  tours: TourHook,
): Promise<OrderUpdateResult> {
  const id = idSchema.safeParse(rawId);
  if (!id.success) return { ok: false, error: "not_found" };
  const existing = await db.order.findUnique({
    where: { id: id.data },
    select: {
      customerId: true,
      status: true,
      deliveryDate: true,
      items: { select: { productId: true } },
    },
  });
  if (!existing) return { ok: false, error: "not_found" };
  if (!isOrderEditable(existing, today)) return { ok: false, error: "not_editable" };

  const parsed = orderInputSchema.safeParse({
    ...(isRecord(rawInput) ? rawInput : {}),
    customerId: existing.customerId,
    screenshotKey: null,
  });
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;
  if (isPastDeliveryDate(v.deliveryDate, today)) return { ok: false, error: "date_in_past" };

  const products = await db.product.findMany({
    where: { id: { in: v.lines.map((l) => l.productId) } },
    select: { id: true, active: true },
  });
  if (products.length !== v.lines.length) return { ok: false, error: "product_not_found" };
  const already = new Set(existing.items.map((i) => i.productId));
  if (products.some((p) => !p.active && !already.has(p.id))) {
    return { ok: false, error: "product_inactive" };
  }

  const stored = await db.$transaction(async (tx) => {
    // Read the state we replace inside the transaction: the flag must reflect what was really there.
    const before = await tx.order.findUnique({
      where: { id: id.data },
      select: {
        customerId: true,
        status: true,
        deliveryDate: true,
        internalNote: true,
        items: { select: { productId: true, quantity: true } },
      },
    });
    if (!before) return false;
    await tx.order.update({
      where: { id: id.data },
      data: {
        deliveryDate: v.deliveryDate,
        status: v.status,
        internalNote: v.internalNote,
        items: {
          deleteMany: {},
          create: v.lines.map((l) => ({
            productId: l.productId,
            quantity: centsToDecimal(l.quantityCents),
          })),
        },
      },
      select: { id: true },
    });
    // One entry per save, with exactly what differs; a save that changes nothing writes none.
    const diff = diffOrderUpdate(
      {
        status: before.status,
        deliveryDate: formatCalendarDate(before.deliveryDate),
        internalNote: before.internalNote,
        items: before.items,
      },
      {
        status: v.status,
        deliveryDate: formatCalendarDate(v.deliveryDate),
        internalNote: v.internalNote ?? null,
        items: v.lines.map((l) => ({
          productId: l.productId,
          quantity: centsToDecimal(l.quantityCents),
        })),
      },
    );
    if (diff) {
      await recordAudit(tx, {
        actorId,
        entity: "Order",
        entityId: id.data,
        action: "order.update",
        diff,
      });
    }
    await flagAffectedTours(tours, tx, before, {
      status: v.status,
      customerId: before.customerId,
      deliveryDate: v.deliveryDate,
      items: v.lines.map((l) => ({
        productId: l.productId,
        quantity: centsToDecimal(l.quantityCents),
      })),
    });
    return true;
  });
  if (!stored) return { ok: false, error: "not_found" };
  return { ok: true, id: id.data, status: v.status };
}

export type OrderCancelResult =
  { ok: true; id: string } | { ok: false; error: "invalid" | "not_found" | "not_editable" };

/**
 * Cancels an open order: status CANCELLED, nothing is deleted (items, screenshot and stop links
 * stay as history). Cancelled orders leave the totals and can never be part of a tour. Orders of
 * past days and already cancelled orders are rejected with `not_editable`.
 */
export async function cancelOrder(
  db: Pick<PrismaClient, "order" | "auditLog" | "$transaction">,
  actorId: string,
  rawId: unknown,
  today: Date,
  tours: TourHook,
): Promise<OrderCancelResult> {
  const id = idSchema.safeParse(rawId);
  if (!id.success) return { ok: false, error: "invalid" };
  const existing = await db.order.findUnique({
    where: { id: id.data },
    select: { status: true, deliveryDate: true },
  });
  if (!existing) return { ok: false, error: "not_found" };
  if (!isOrderEditable(existing, today)) return { ok: false, error: "not_editable" };
  const cancelled = await db.$transaction(async (tx) => {
    const before = await tx.order.findUnique({
      where: { id: id.data },
      select: {
        customerId: true,
        status: true,
        deliveryDate: true,
        items: { select: { productId: true, quantity: true } },
      },
    });
    if (!before) return false;
    await tx.order.update({
      where: { id: id.data },
      data: { status: "CANCELLED" },
      select: { id: true },
    });
    await recordAudit(tx, {
      actorId,
      entity: "Order",
      entityId: id.data,
      action: "order.cancel",
      diff: { status: { from: before.status, to: "CANCELLED" } },
    });
    await flagAffectedTours(tours, tx, before, { ...before, status: "CANCELLED" });
    return true;
  });
  if (!cancelled) return { ok: false, error: "not_found" };
  return { ok: true, id: id.data };
}

export type OrderDuplicateResult =
  { ok: true; id: string } | { ok: false; error: OrderMutationError };

/**
 * Copies an order (any status) to another delivery day, today or later: same customer, lines
 * and internal note. The copy is a DRAFT with source MANUAL and without screenshot (the
 * screenshot belongs to the original message); it must be confirmed on purpose. The customer
 * must still be active and all products active.
 */
export async function duplicateOrder(
  db: OrderDb,
  actorId: string,
  rawId: unknown,
  rawDate: unknown,
  today: Date,
  tours: TourHook,
): Promise<OrderDuplicateResult> {
  const id = idSchema.safeParse(rawId);
  if (!id.success) return { ok: false, error: "not_found" };
  const date = typeof rawDate === "string" ? parseCalendarDate(rawDate.trim()) : null;
  if (!date) return { ok: false, error: "invalid" };
  if (isPastDeliveryDate(date, today)) return { ok: false, error: "date_in_past" };
  const source = await db.order.findUnique({
    where: { id: id.data },
    select: {
      customerId: true,
      internalNote: true,
      customer: { select: { active: true } },
      items: { select: { productId: true, quantity: true, product: { select: { active: true } } } },
    },
  });
  if (!source) return { ok: false, error: "not_found" };
  if (!source.customer.active) return { ok: false, error: "customer_inactive" };
  if (source.items.some((i) => !i.product.active)) return { ok: false, error: "product_inactive" };
  const copy = await db.$transaction(async (tx) => {
    const created = await tx.order.create({
      data: {
        customer: { connect: { id: source.customerId } },
        deliveryDate: date,
        status: "DRAFT",
        source: "MANUAL",
        internalNote: source.internalNote,
        createdBy: { connect: { id: actorId } },
        items: {
          create: source.items.map((i) => ({
            productId: i.productId,
            quantity: i.quantity.toString(),
          })),
        },
      },
      select: { id: true },
    });
    await recordAudit(tx, {
      actorId,
      entity: "Order",
      entityId: created.id,
      action: "order.duplicate",
      diff: {
        sourceOrderId: id.data,
        customerId: source.customerId,
        status: "DRAFT",
        deliveryDate: formatCalendarDate(date),
        internalNote: source.internalNote ?? null,
        lines: source.items.map((i): LineChange => ({
          productId: i.productId,
          before: null,
          after: parseQuantityCents(i.quantity.toString()) ?? 0,
        })),
      },
    });
    // A copy is a draft, so this flags nothing; it stays here so the rule lives in one place.
    await flagAffectedTours(tours, tx, null, {
      status: "DRAFT",
      customerId: source.customerId,
      deliveryDate: date,
      items: source.items,
    });
    return created;
  });
  return { ok: true, id: copy.id };
}
