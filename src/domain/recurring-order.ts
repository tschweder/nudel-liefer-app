/**
 * Recurring orders (Dauerbestellungen, NUD-149, D25). Pure schedule logic: which calendar days a
 * rule delivers on. No framework or database imports. All dates are `DATE` values held as UTC
 * midnight, like `Order.deliveryDate`.
 */
import { z } from "zod";

import { MAX_ORDER_LINES, MAX_QUANTITY, mergeOrderLines, parseCalendarDate } from "./order";
import { isoWeekday } from "./settings";

const DAY_MS = 86_400_000;

export const MAX_EVERY_N_WEEKS = 52;
export const MAX_EXCEPTIONS = 200;
export const MIN_LEAD_DAYS = 1;
export const MAX_LEAD_DAYS = 60;
export const DEFAULT_LEAD_DAYS = 14;

export type RecurringSchedule = {
  /** ISO weekdays, 1 = Monday ... 7 = Sunday. */
  weekdays: readonly number[];
  everyNWeeks: number;
  /** First day the rule can apply to; its week (Monday to Sunday) is week 0 of the cycle. */
  anchorDate: Date;
  /** `MM-DD`; both or none. `seasonFrom > seasonTo` wraps over the year boundary. */
  seasonFrom: string | null;
  seasonTo: string | null;
  exceptions: readonly Date[];
};

const MM_DD = /^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;

export function isMonthDay(value: string): boolean {
  return MM_DD.test(value);
}

/** `MM-DD` of a `DATE` value. */
export function monthDay(date: Date): string {
  return date.toISOString().slice(5, 10);
}

/**
 * Season check on `MM-DD` strings (they sort like calendar days). "09-01".."05-31" covers
 * September to May: the end lies before the start, so the season wraps over New Year. Without a
 * season every day is in season.
 */
export function inSeason(date: Date, from: string | null, to: string | null): boolean {
  if (from === null || to === null) return true;
  const md = monthDay(date);
  return from <= to ? md >= from && md <= to : md >= from || md <= to;
}

/** Monday of the week of a `DATE` value, as a day number (days since the epoch). */
function mondayDay(date: Date): number {
  return Math.floor(date.getTime() / DAY_MS) - (isoWeekday(date) - 1);
}

/** Whether the rule delivers on `date` (a `DATE` value). */
export function occursOn(rule: RecurringSchedule, date: Date): boolean {
  if (date.getTime() < rule.anchorDate.getTime()) return false;
  if (!rule.weekdays.includes(isoWeekday(date))) return false;
  const weeks = (mondayDay(date) - mondayDay(rule.anchorDate)) / 7;
  if (weeks % Math.max(1, rule.everyNWeeks) !== 0) return false;
  if (!inSeason(date, rule.seasonFrom, rule.seasonTo)) return false;
  return !rule.exceptions.some((e) => e.getTime() === date.getTime());
}

/** All delivery days of the rule from `from` to `to`, both inclusive, ascending. */
export function scheduleDates(rule: RecurringSchedule, from: Date, to: Date): Date[] {
  const out: Date[] = [];
  for (let t = from.getTime(); t <= to.getTime(); t += DAY_MS) {
    const day = new Date(t);
    if (occursOn(rule, day)) out.push(day);
  }
  return out;
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** Last day the daily job generates for when it runs on `today`. */
export function generationHorizon(today: Date, leadDays: number): Date {
  return addDays(today, Math.min(MAX_LEAD_DAYS, Math.max(MIN_LEAD_DAYS, leadDays)));
}

const dateText = z
  .string()
  .trim()
  .max(10)
  .transform((v, ctx) => {
    const d = parseCalendarDate(v);
    if (!d) ctx.addIssue({ code: "custom", message: "invalid date" });
    return d ?? new Date(0);
  });

/** Input of the rule form (create and update). Validated again on the server. */
export const recurringOrderInputSchema = z
  .object({
    customerId: z.string().trim().min(1).max(64),
    weekdays: z
      .array(z.number().int().min(1).max(7))
      .min(1)
      .max(7)
      .transform((days) => [...new Set(days)].sort((a, b) => a - b)),
    everyNWeeks: z.number().int().min(1).max(MAX_EVERY_N_WEEKS).default(1),
    anchorDate: dateText,
    seasonFrom: z
      .string()
      .trim()
      .max(5)
      .regex(MM_DD)
      .nullish()
      .transform((v) => v ?? null),
    seasonTo: z
      .string()
      .trim()
      .max(5)
      .regex(MM_DD)
      .nullish()
      .transform((v) => v ?? null),
    exceptions: z
      .array(dateText)
      .max(MAX_EXCEPTIONS)
      .default([])
      .transform((days) =>
        [...new Map(days.map((d) => [d.getTime(), d])).values()].sort(
          (a, b) => a.getTime() - b.getTime(),
        ),
      ),
    lines: z
      .array(
        z.object({
          productId: z.string().trim().min(1).max(64),
          quantity: z.number().int().min(1).max(MAX_QUANTITY),
        }),
      )
      .min(1)
      .max(MAX_ORDER_LINES)
      .transform((lines, ctx) => {
        const merged = mergeOrderLines(lines);
        if (!merged) ctx.addIssue({ code: "custom", message: "invalid lines" });
        return merged ?? [];
      }),
  })
  .refine((v) => (v.seasonFrom === null) === (v.seasonTo === null), { message: "season" });

export type RecurringOrderInput = z.input<typeof recurringOrderInputSchema>;
export type ValidRecurringOrder = z.output<typeof recurringOrderInputSchema>;

/** How a rule is shown in the list: running, paused by the office, or paused with its customer. */
export type RuleState = "active" | "paused" | "customer_inactive";

export function ruleState(rule: { active: boolean; pausedByCustomer: boolean }): RuleState {
  if (rule.active) return "active";
  return rule.pausedByCustomer ? "customer_inactive" : "paused";
}

/** The next `count` delivery days of the rule on or after `from` (looks at most `maxDays` ahead). */
export function nextScheduleDates(
  rule: RecurringSchedule,
  from: Date,
  count: number,
  maxDays = 400,
): Date[] {
  const out: Date[] = [];
  const start = Math.max(from.getTime(), rule.anchorDate.getTime());
  for (let i = 0; i <= maxDays && out.length < count; i += 1) {
    const day = new Date(start + i * DAY_MS);
    if (occursOn(rule, day)) out.push(day);
  }
  return out;
}
