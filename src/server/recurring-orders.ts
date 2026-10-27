import { z } from "zod";

import { toAuditQuantity } from "@/domain/audit";
import { formatCalendarDate } from "@/domain/order";
import {
  DEFAULT_LEAD_DAYS,
  generationHorizon,
  nextScheduleDates,
  recurringOrderInputSchema,
  type RecurringSchedule,
  type RuleState,
  ruleState,
  scheduleDates,
} from "@/domain/recurring-order";
import { outdatedTourDates } from "@/domain/tour-diff";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";

import { recordAudit } from "./audit";
import type { TourHook } from "./orders";
import type { TourDb } from "./tour-service";

/**
 * Recurring orders (Dauerbestellungen, NUD-149, D25). The office confirms a rule once; the daily
 * job (`GET /api/cron/recurring-orders`) and every rule save generate CONFIRMED orders for the
 * rule's days from today to `Settings.recurringLeadDays` ahead. Idempotent: the unique key
 * (recurringOrderId, recurringDate) allows one order per rule and day, also after the office
 * cancelled that order (it is not generated again). Rules are never deleted: `active=false` pauses
 * them. Orders already generated stay when a rule is edited or paused (the office cancels them
 * on the order page); only a customer set inactive cancels them (see `cascadeCustomerInactive`).
 * Every write is audited in its own transaction; generated orders are attributed to the person
 * who confirmed the rule.
 */

export type RecurringDb = Pick<
  PrismaClient,
  "recurringOrder" | "customer" | "product" | "order" | "settings" | "auditLog" | "$transaction"
>;

const idSchema = z.string().trim().min(1).max(64);

export type RuleLine = {
  id: string;
  productId: string;
  productName: unknown;
  unit: string;
  quantity: number;
};

export type RecurringRuleView = {
  id: string;
  customerId: string;
  weekdays: number[];
  everyNWeeks: number;
  /** `YYYY-MM-DD` */
  anchorDate: string;
  seasonFrom: string | null;
  seasonTo: string | null;
  exceptions: string[];
  state: RuleState;
  confirmedAt: Date;
  confirmedBy: string | null;
  lines: RuleLine[];
  /** The next three delivery days (`YYYY-MM-DD`) of a running rule. */
  nextDates: string[];
};

export type RuleSaveResult =
  | { ok: true; id: string; generated: number }
  | {
      ok: false;
      error:
        | "invalid"
        | "not_found"
        | "customer_not_found"
        | "customer_inactive"
        | "product_not_found"
        | "product_inactive";
    };

type StoredRule = {
  id: string;
  weekdays: number[];
  everyNWeeks: number;
  anchorDate: Date;
  seasonFrom: string | null;
  seasonTo: string | null;
  exceptions: Date[];
};

const asSchedule = (r: StoredRule): RecurringSchedule => r;

function snapshot(
  r: StoredRule & { lines: ReadonlyArray<{ productId: string; quantity: number }> },
) {
  return {
    weekdays: r.weekdays,
    everyNWeeks: r.everyNWeeks,
    anchorDate: formatCalendarDate(r.anchorDate),
    seasonFrom: r.seasonFrom,
    seasonTo: r.seasonTo,
    exceptions: r.exceptions.map(formatCalendarDate),
    lines: r.lines.map((l) => ({ productId: l.productId, quantity: toAuditQuantity(l.quantity) })),
  };
}

/** Settings.recurringLeadDays, 14 before the first settings save. */
export async function readLeadDays(db: Pick<PrismaClient, "settings">): Promise<number> {
  const row = await db.settings.findUnique({
    where: { id: 1 },
    select: { recurringLeadDays: true },
  });
  return row?.recurringLeadDays ?? DEFAULT_LEAD_DAYS;
}

// ---- generation ----

export type GenerationReport = {
  rules: number;
  created: number;
  /** Days that already had an order (also cancelled ones). */
  existing: number;
  /** Days skipped because every product of the rule is inactive now. */
  skipped: number;
};

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Generates the missing orders of all running rules (or only `ruleIds`) for the days from `today`
 * to today + lead days. Safe to run any number of times, also concurrently: a second order for the
 * same rule and day hits the unique key and is counted as existing.
 */
export async function generateRecurringOrders(
  db: RecurringDb,
  options: { today: Date; tours: TourHook; ruleIds?: readonly string[]; leadDays?: number },
): Promise<GenerationReport> {
  const report: GenerationReport = { rules: 0, created: 0, existing: 0, skipped: 0 };
  const horizon = generationHorizon(options.today, options.leadDays ?? (await readLeadDays(db)));
  const rules = await db.recurringOrder.findMany({
    where: {
      active: true,
      customer: { active: true },
      ...(options.ruleIds ? { id: { in: [...options.ruleIds] } } : {}),
    },
    orderBy: { createdAt: "asc" },
    include: {
      items: {
        where: { product: { active: true } },
        select: { productId: true, quantity: true },
        orderBy: { id: "asc" },
      },
    },
  });
  for (const rule of rules) {
    report.rules += 1;
    const days = scheduleDates(asSchedule(rule), options.today, horizon);
    if (days.length === 0) continue;
    const have = new Set(
      (
        await db.order.findMany({
          where: { recurringOrderId: rule.id, recurringDate: { in: days } },
          select: { recurringDate: true },
        })
      ).map((o) => o.recurringDate?.getTime()),
    );
    for (const day of days) {
      if (have.has(day.getTime())) {
        report.existing += 1;
        continue;
      }
      if (rule.items.length === 0) {
        report.skipped += 1;
        continue;
      }
      try {
        await db.$transaction(async (tx) => {
          const created = await tx.order.create({
            data: {
              customer: { connect: { id: rule.customerId } },
              deliveryDate: day,
              windowFrom: day,
              windowTo: day,
              status: "CONFIRMED",
              source: "MANUAL",
              recurringOrder: { connect: { id: rule.id } },
              recurringDate: day,
              createdBy: { connect: { id: rule.confirmedById } },
              items: {
                create: rule.items.map((l) => ({ productId: l.productId, quantity: l.quantity })),
              },
            },
            select: { id: true },
          });
          await recordAudit(tx, {
            actorId: rule.confirmedById,
            entity: "Order",
            entityId: created.id,
            action: "order.create",
            diff: {
              customerId: rule.customerId,
              status: "CONFIRMED",
              deliveryDate: formatCalendarDate(day),
              window: `${formatCalendarDate(day)}..${formatCalendarDate(day)}`,
              source: "MANUAL",
              recurringOrderId: rule.id,
              lines: rule.items.map((l) => ({
                productId: l.productId,
                before: null,
                after: toAuditQuantity(l.quantity),
              })),
            },
          });
          await flagTours(options.tours, tx, null, {
            status: "CONFIRMED",
            customerId: rule.customerId,
            deliveryDate: day,
            items: rule.items,
          });
        });
        report.created += 1;
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        report.existing += 1;
      }
    }
  }
  return report;
}

type FlagState = Parameters<typeof outdatedTourDates>[0];

async function flagTours(
  tours: TourHook,
  tx: TourDb,
  before: FlagState,
  after: FlagState,
): Promise<void> {
  for (const date of outdatedTourDates(before, after)) {
    await tours.markOutdatedForDate(date, tx);
  }
}

// ---- rules ----

async function checkCustomerAndProducts(
  db: RecurringDb,
  customerId: string,
  productIds: readonly string[],
): Promise<Extract<RuleSaveResult, { ok: false }>["error"] | null> {
  const customer = await db.customer.findUnique({
    where: { id: customerId },
    select: { active: true },
  });
  if (!customer) return "customer_not_found";
  if (!customer.active) return "customer_inactive";
  const products = await db.product.findMany({
    where: { id: { in: [...productIds] } },
    select: { active: true },
  });
  if (products.length !== productIds.length) return "product_not_found";
  if (products.some((p) => !p.active)) return "product_inactive";
  return null;
}

type Context = { today: Date; tours: TourHook };

/** Confirms a new rule (the office confirms it once) and generates its orders right away. */
export async function createRecurringOrder(
  db: RecurringDb,
  actorId: string,
  rawInput: unknown,
  ctx: Context,
): Promise<RuleSaveResult> {
  const parsed = recurringOrderInputSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;
  const problem = await checkCustomerAndProducts(
    db,
    v.customerId,
    v.lines.map((l) => l.productId),
  );
  if (problem) return { ok: false, error: problem };
  const id = await db.$transaction(async (tx) => {
    const row = await tx.recurringOrder.create({
      data: {
        customer: { connect: { id: v.customerId } },
        weekdays: v.weekdays,
        everyNWeeks: v.everyNWeeks,
        anchorDate: v.anchorDate,
        seasonFrom: v.seasonFrom,
        seasonTo: v.seasonTo,
        exceptions: v.exceptions,
        confirmedBy: { connect: { id: actorId } },
        items: { create: v.lines.map((l) => ({ productId: l.productId, quantity: l.quantity })) },
      },
      select: { id: true },
    });
    await recordAudit(tx, {
      actorId,
      entity: "RecurringOrder",
      entityId: row.id,
      action: "recurring.create",
      diff: { customerId: v.customerId, ...snapshot({ id: row.id, ...v, lines: v.lines }) },
    });
    return row.id;
  });
  const report = await generateRecurringOrders(db, { ...ctx, ruleIds: [id] });
  return { ok: true, id, generated: report.created };
}

/**
 * Saves a changed rule (the office confirms it again). Orders generated earlier stay as they are;
 * the new schedule applies to days that have no order yet.
 */
export async function updateRecurringOrder(
  db: RecurringDb,
  actorId: string,
  rawId: unknown,
  rawInput: unknown,
  ctx: Context,
): Promise<RuleSaveResult> {
  const id = idSchema.safeParse(rawId);
  const parsed = recurringOrderInputSchema.safeParse(rawInput);
  if (!id.success || !parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;
  const stored = await db.recurringOrder.findUnique({
    where: { id: id.data },
    include: { items: { select: { productId: true, quantity: true }, orderBy: { id: "asc" } } },
  });
  if (!stored) return { ok: false, error: "not_found" };
  if (stored.customerId !== v.customerId) return { ok: false, error: "invalid" };
  const problem = await checkCustomerAndProducts(
    db,
    v.customerId,
    v.lines.map((l) => l.productId),
  );
  if (problem) return { ok: false, error: problem };
  await db.$transaction(async (tx) => {
    await tx.recurringOrder.update({
      where: { id: stored.id },
      data: {
        weekdays: v.weekdays,
        everyNWeeks: v.everyNWeeks,
        anchorDate: v.anchorDate,
        seasonFrom: v.seasonFrom,
        seasonTo: v.seasonTo,
        exceptions: v.exceptions,
        confirmedBy: { connect: { id: actorId } },
        confirmedAt: new Date(),
        items: {
          deleteMany: {},
          create: v.lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
        },
      },
    });
    await recordAudit(tx, {
      actorId,
      entity: "RecurringOrder",
      entityId: stored.id,
      action: "recurring.update",
      diff: {
        customerId: stored.customerId,
        before: snapshot({ ...stored, lines: stored.items }),
        after: snapshot({ id: stored.id, ...v, lines: v.lines }),
      },
    });
  });
  const report = stored.active
    ? await generateRecurringOrders(db, { ...ctx, ruleIds: [stored.id] })
    : { created: 0 };
  return { ok: true, id: stored.id, generated: report.created };
}

export type RulePauseResult =
  | { ok: true; generated: number }
  | { ok: false; error: "invalid" | "not_found" | "customer_inactive" };

/** Pause (`active=false`) or resume a rule. Soft delete only: rules are never removed. */
export async function setRecurringOrderActive(
  db: RecurringDb,
  actorId: string,
  rawId: unknown,
  rawActive: unknown,
  ctx: Context,
): Promise<RulePauseResult> {
  const id = idSchema.safeParse(rawId);
  const active = z.boolean().safeParse(rawActive);
  if (!id.success || !active.success) return { ok: false, error: "invalid" };
  const stored = await db.recurringOrder.findUnique({
    where: { id: id.data },
    select: { id: true, active: true, customer: { select: { active: true } } },
  });
  if (!stored) return { ok: false, error: "not_found" };
  if (active.data && !stored.customer.active) return { ok: false, error: "customer_inactive" };
  if (stored.active !== active.data) {
    await db.$transaction(async (tx) => {
      await tx.recurringOrder.update({
        where: { id: stored.id },
        data: { active: active.data, pausedByCustomer: false },
      });
      await recordAudit(tx, {
        actorId,
        entity: "RecurringOrder",
        entityId: stored.id,
        action: active.data ? "recurring.resume" : "recurring.pause",
        diff: { active: { from: stored.active, to: active.data } },
      });
    });
  }
  const report = active.data
    ? await generateRecurringOrders(db, { ...ctx, ruleIds: [stored.id] })
    : { created: 0 };
  return { ok: true, generated: report.created };
}

/** Rules of one customer for the customer page, running ones first. */
export async function listRecurringOrders(
  db: Pick<PrismaClient, "recurringOrder">,
  rawCustomerId: unknown,
  today: Date,
): Promise<RecurringRuleView[]> {
  const customerId = idSchema.safeParse(rawCustomerId);
  if (!customerId.success) return [];
  const rows = await db.recurringOrder.findMany({
    where: { customerId: customerId.data },
    orderBy: [{ active: "desc" }, { createdAt: "asc" }],
    include: {
      confirmedBy: { select: { displayName: true } },
      items: {
        orderBy: { id: "asc" },
        include: { product: { select: { name: true, unit: true } } },
      },
    },
  });
  return rows.map((r) => {
    const state = ruleState(r);
    return {
      id: r.id,
      customerId: r.customerId,
      weekdays: r.weekdays,
      everyNWeeks: r.everyNWeeks,
      anchorDate: formatCalendarDate(r.anchorDate),
      seasonFrom: r.seasonFrom,
      seasonTo: r.seasonTo,
      exceptions: r.exceptions.map(formatCalendarDate),
      state,
      confirmedAt: r.confirmedAt,
      confirmedBy: r.confirmedBy.displayName,
      lines: r.items.map((i) => ({
        id: i.id,
        productId: i.productId,
        productName: i.product.name,
        unit: i.product.unit,
        quantity: i.quantity,
      })),
      nextDates:
        state === "active"
          ? nextScheduleDates(asSchedule(r), today, 3).map(formatCalendarDate)
          : [],
    };
  });
}

// ---- customer inactive / active ----

export type CascadeReport = { cancelledOrders: number; pausedRules: number };

/**
 * Called inside the transaction that sets a customer inactive (D25): every running rule is paused
 * (`pausedByCustomer`), and every order of that customer from today on that is not yet delivered
 * (DRAFT or CONFIRMED, not on a stop the driver completed) becomes CANCELLED. Nothing is deleted.
 * Tours that contained a cancelled order are flagged outdated, so the office re-releases them.
 */
export async function cascadeCustomerInactive(
  tx: Pick<PrismaClient, "recurringOrder" | "order" | "auditLog" | "tour">,
  tours: TourHook,
  actorId: string,
  customerId: string,
  today: Date,
): Promise<CascadeReport> {
  const rules = await tx.recurringOrder.findMany({
    where: { customerId, active: true },
    select: { id: true },
  });
  for (const rule of rules) {
    await tx.recurringOrder.update({
      where: { id: rule.id },
      data: { active: false, pausedByCustomer: true },
    });
    await recordAudit(tx, {
      actorId,
      entity: "RecurringOrder",
      entityId: rule.id,
      action: "recurring.pause",
      diff: { active: { from: true, to: false }, reason: "customer_inactive" },
    });
  }
  const orders = await tx.order.findMany({
    where: {
      customerId,
      status: { in: ["DRAFT", "CONFIRMED"] },
      deliveryDate: { gte: today },
      stopOrders: { none: { stop: { status: { in: ["DELIVERED", "PROBLEM"] } } } },
    },
    select: {
      id: true,
      status: true,
      customerId: true,
      deliveryDate: true,
      items: { select: { productId: true, quantity: true } },
    },
    orderBy: [{ deliveryDate: "asc" }, { id: "asc" }],
  });
  for (const order of orders) {
    await tx.order.update({ where: { id: order.id }, data: { status: "CANCELLED" } });
    await recordAudit(tx, {
      actorId,
      entity: "Order",
      entityId: order.id,
      action: "order.cancel",
      diff: { status: { from: order.status, to: "CANCELLED" }, reason: "customer_inactive" },
    });
    await flagTours(tours, tx, order, { ...order, status: "CANCELLED" });
  }
  return { cancelledOrders: orders.length, pausedRules: rules.length };
}

/** Called inside the transaction that reactivates a customer: resumes the rules paused with him. */
export async function resumeCustomerRules(
  tx: Pick<PrismaClient, "recurringOrder" | "auditLog">,
  actorId: string,
  customerId: string,
): Promise<string[]> {
  const rules = await tx.recurringOrder.findMany({
    where: { customerId, active: false, pausedByCustomer: true },
    select: { id: true },
  });
  for (const rule of rules) {
    await tx.recurringOrder.update({
      where: { id: rule.id },
      data: { active: true, pausedByCustomer: false },
    });
    await recordAudit(tx, {
      actorId,
      entity: "RecurringOrder",
      entityId: rule.id,
      action: "recurring.resume",
      diff: { active: { from: false, to: true }, reason: "customer_active" },
    });
  }
  return rules.map((r) => r.id);
}
