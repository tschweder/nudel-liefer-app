import { toAuditQuantity } from "@/domain/audit";
import { correctionCandidates, isOpenTour } from "@/domain/day-tours";
import { formatCalendarDate, isPastDeliveryDate, parseCalendarDate } from "@/domain/order";
import { calendarDayIn } from "@/domain/settings";
import type { PrismaClient } from "@/generated/prisma/client";

import { recordAudit } from "./audit";
import { getDb } from "./db";
import { deliveredConflictsOf, loadDayDeliveryData } from "./late-orders";
import { getSettings } from "./settings";
import { generateFollowUpTour, type GenerateTourResult } from "./tour-builder";

/**
 * Correction delivery (NUD-117). NUD-099 reports an increase of an order whose stop was already
 * delivered as a conflict note and leaves it to the office, which would have to type the difference
 * as a second order. This service does exactly that in one step and reuses the follow-up-tour
 * machinery: the difference (new quantity minus delivered quantity, increases only) becomes a
 * CONFIRMED order of the same day and that order is handed to a follow-up tour for the day.
 *
 * Why an order and not a stop written directly: a `Stop` is the snapshot released to the driver and
 * is rebuilt from its orders on every re-release (`StopOrder` links are the source), so a
 * hand-written stop would lose the difference on the next rebuild and would show a stop that no
 * order explains. An order keeps the day, the totals, the load sheet and the audit trail consistent.
 *
 * Rules kept from NUD-043/099: the completed tour is never touched, its stops are never reset, a
 * decrease or a cancellation is never "corrected" (goods cannot be un-delivered) and only a
 * difference that is not planned yet is offered (`correctionCandidates`). The caller
 * (`createCorrectionDeliveryAction`) has checked the ADMIN role.
 */

export type CorrectionDeliveryError =
  | "invalid_date"
  | "date_in_past"
  /** No delivered stop of the day has an increase that is not already planned. */
  | "no_corrections"
  /** The day has tours, and at least one of them is not COMPLETED yet. */
  | "follow_up_not_allowed";

export type CorrectionOrders = {
  ok: true;
  /** One new CONFIRMED order per customer, carrying exactly the difference. */
  orderIds: string[];
  customerIds: string[];
};

export type CorrectionDeliveryResult =
  | (CorrectionOrders & {
      /**
       * The follow-up tour built from them (`generateFollowUpTour`). When it failed (e.g. the
       * customer has no Parkplatz and no Adresspunkt) the orders exist and are reported as late
       * orders, so the office can fix the location and create the tour by hand.
       */
      followUp: GenerateTourResult;
    })
  | { ok: false; error: CorrectionDeliveryError };

export type CorrectionDeliveryDeps = {
  db: PrismaClient;
  /** The admin who asked for it; recorded in the audit log of every new order. */
  actorId: string;
  loadSettings: () => Promise<{ timezone: string } | null>;
  /** Builds the follow-up tour for `YYYY-MM-DD` (the real `generateFollowUpTour` outside tests). */
  createFollowUpTour: (date: string) => Promise<GenerateTourResult>;
  now?: () => Date;
};

/** `YYYY-MM-DD` of a `DATE` column value (UTC midnight). */
function parseDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) && value.getTime() % 86_400_000 === 0 ? value : null;
  }
  return typeof value === "string" ? parseCalendarDate(value.trim()) : null;
}

/**
 * Turns the increases of already delivered stops into a follow-up delivery. Everything is decided
 * inside one transaction that holds the day's planning lock, so a second click (or a stale page)
 * cannot book the same goods twice: after the first run the difference is either on a stop of the
 * follow-up tour or waiting as an unplanned order, and both switch the correction off.
 */
export async function createCorrectionDeliveryWith(
  deps: CorrectionDeliveryDeps,
  rawDate: unknown,
): Promise<CorrectionDeliveryResult> {
  const date = parseDate(rawDate);
  if (!date) return { ok: false, error: "invalid_date" };
  const settings = await deps.loadSettings();
  const now = (deps.now ?? (() => new Date()))();
  const { y, m, d } = calendarDayIn(now, settings?.timezone ?? "Europe/Vienna");
  if (isPastDeliveryDate(date, new Date(Date.UTC(y, m - 1, d)))) {
    return { ok: false, error: "date_in_past" };
  }
  const day = formatCalendarDate(date);

  const created = await deps.db.$transaction(
    async (tx): Promise<CorrectionOrders | { ok: false; error: CorrectionDeliveryError }> => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`tour:${day}`}))`;
      // Read the day inside the lock: what is offered must be what is written.
      const data = await loadDayDeliveryData(tx, date);
      if (data.tours.length === 0 || data.tours.some((t) => isOpenTour(t.status))) {
        return { ok: false, error: "follow_up_not_allowed" };
      }
      const conflicts = deliveredConflictsOf(data);
      const candidates = correctionCandidates(conflicts, data.stops, data.orders);
      if (candidates.length === 0) return { ok: false, error: "no_corrections" };

      const orderIds: string[] = [];
      for (const candidate of candidates) {
        const order = await tx.order.create({
          data: {
            customerId: candidate.customerId,
            // The difference belongs to the delivered day; a follow-up tour of that day delivers it.
            deliveryDate: date,
            windowFrom: date,
            windowTo: date,
            status: "CONFIRMED",
            source: "MANUAL",
            createdById: deps.actorId,
            items: {
              create: candidate.items.map((item) => ({
                productId: item.productId,
                quantity: item.quantity,
              })),
            },
          },
          select: { id: true },
        });
        orderIds.push(order.id);
        const delivered = conflicts.find((c) => c.stopId === candidate.stopId);
        await recordAudit(tx, {
          actorId: deps.actorId,
          entity: "Order",
          entityId: order.id,
          action: "order.create",
          diff: {
            customerId: candidate.customerId,
            status: "CONFIRMED",
            deliveryDate: day,
            window: day,
            source: "MANUAL",
            internalNote: null,
            lines: candidate.items.map((item) => ({
              productId: item.productId,
              before: null,
              after: toAuditQuantity(item.quantity),
            })),
            // NUD-117: why this order exists — the difference of a stop that was delivered already.
            correction: {
              reason: "delivered_stop_increase",
              stopId: candidate.stopId,
              lines: (delivered?.items ?? []).map((item) => ({
                productId: item.productId,
                delivered: item.before,
                ordered: item.after,
              })),
            },
          },
        });
      }
      return { ok: true, orderIds, customerIds: candidates.map((c) => c.customerId) };
    },
    { timeout: 20_000, maxWait: 10_000 },
  );
  if (!created.ok) return created;

  // Outside the transaction: routing needs the network and must not hold the lock.
  const followUp = await deps.createFollowUpTour(day);
  return { ...created, followUp };
}

/** Application entry (callers: `createCorrectionDeliveryAction`). */
export async function createCorrectionDelivery(
  actorId: string,
  rawDate: unknown,
): Promise<CorrectionDeliveryResult> {
  return createCorrectionDeliveryWith(
    {
      db: getDb(),
      actorId,
      loadSettings: async () => {
        const settings = await getSettings();
        return settings ? { timezone: settings.timezone } : null;
      },
      createFollowUpTour: (day) => generateFollowUpTour(actorId, day),
    },
    rawDate,
  );
}
