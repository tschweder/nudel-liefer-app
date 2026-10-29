/**
 * Recurring orders (Dauerbestellungen, NUD-149, D25; more patterns NUD-171). Pure schedule logic:
 * which calendar days a rule delivers on and which products a single delivery day carries. No
 * framework or database imports. All dates are `DATE` values held as UTC midnight, like
 * `Order.deliveryDate`.
 *
 * A rule delivers on the UNION of its weekly pattern (`weekdays` + `everyNWeeks`) and its monthly
 * patterns (`monthlyRules`); every other gate (anchor date, season, single-day `exceptions`, the
 * skipped range, `endsOn`) applies to both halves.
 */
import { z } from "zod";

import { parseTimeOfDay } from "./delivery-window";
import { MAX_ORDER_LINES, MAX_QUANTITY, mergeOrderLines, parseCalendarDate } from "./order";
import { isoWeekday } from "./settings";

const DAY_MS = 86_400_000;

export const MAX_EVERY_N_WEEKS = 52;
export const MAX_EXCEPTIONS = 200;
export const MIN_LEAD_DAYS = 1;
export const MAX_LEAD_DAYS = 60;
export const DEFAULT_LEAD_DAYS = 14;
/** Monthly building blocks per rule; the migration's CHECK allows at most this many. */
export const MAX_MONTHLY_RULES = 10;
/** Per-weekday product lists: seven weekdays with at most one full order each. */
export const MAX_DAY_ITEMS = 7 * MAX_ORDER_LINES;
/** `RecurringOrder.maxDeliveries` upper bound (mirrors the migration's CHECK). */
export const MAX_MAX_DELIVERIES = 1000;

/** One monthly pattern beside the weekly weekdays (NUD-171). */
export type MonthlyRule =
  /** The N-th day of a month. A month with fewer than N days has no such day (see `monthlyRuleMatches`). */
  | { kind: "dayOfMonth"; day: number }
  /** The 1st to 4th (`nth` 1..4) or the last (`nth` -1) given ISO weekday of a month. */
  | { kind: "nthWeekday"; nth: 1 | 2 | 3 | 4 | -1; weekday: number };

export type RecurringSchedule = {
  /** ISO weekdays, 1 = Monday ... 7 = Sunday. Empty is allowed for a monthly-only rule. */
  weekdays: readonly number[];
  everyNWeeks: number;
  /** First day the rule can apply to; its week (Monday to Sunday) is week 0 of the cycle. */
  anchorDate: Date;
  /** `MM-DD`; both or none. `seasonFrom > seasonTo` wraps over the year boundary. */
  seasonFrom: string | null;
  seasonTo: string | null;
  exceptions: readonly Date[];
  /** Monthly patterns added to the weekly ones (NUD-171); missing = none. */
  monthlyRules?: readonly MonthlyRule[];
  /** One connected skipped range (holiday), both or none (NUD-171); missing = none. */
  skipFrom?: Date | null;
  skipTo?: Date | null;
  /** Last day the rule may deliver on (NUD-171); missing = open-ended. */
  endsOn?: Date | null;
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

/** Number of days of the month `date` lies in. */
function lastDayOfMonth(date: Date): number {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
}

/** Whether the monthly pattern alone hits `date` (no gates, no weekly pattern). */
export function monthlyRuleMatches(rule: MonthlyRule, date: Date): boolean {
  if (rule.kind === "dayOfMonth") {
    // Decision (NUD-171): day 31 in a 30-day month does not occur there - it is NOT clamped to the
    // last day, which would silently deliver a day early.
    return date.getUTCDate() === rule.day;
  }
  if (isoWeekday(date) !== rule.weekday) return false;
  if (rule.nth === -1) return date.getUTCDate() + 7 > lastDayOfMonth(date);
  return Math.ceil(date.getUTCDate() / 7) === rule.nth;
}

/** The weekly pattern alone (weekdays and the every-N-weeks cycle). */
function inWeeklyPattern(rule: RecurringSchedule, date: Date): boolean {
  if (!rule.weekdays.includes(isoWeekday(date))) return false;
  const weeks = (mondayDay(date) - mondayDay(rule.anchorDate)) / 7;
  return weeks % Math.max(1, rule.everyNWeeks) === 0;
}

/** Whether the skipped range (both ends inclusive) covers `date`. */
export function isSkipped(
  from: Date | null | undefined,
  to: Date | null | undefined,
  date: Date,
): boolean {
  if (!from || !to) return false;
  return date.getTime() >= from.getTime() && date.getTime() <= to.getTime();
}

/**
 * Whether the rule delivers on `date` (a `DATE` value): the union of the weekly and the monthly
 * patterns, gated by the anchor date, `endsOn`, the skipped range, the season and the single-day
 * exceptions in that order.
 */
export function occursOn(rule: RecurringSchedule, date: Date): boolean {
  if (date.getTime() < rule.anchorDate.getTime()) return false;
  if (rule.endsOn && date.getTime() > rule.endsOn.getTime()) return false;
  if (isSkipped(rule.skipFrom, rule.skipTo, date)) return false;
  if (!inSeason(date, rule.seasonFrom, rule.seasonTo)) return false;
  if (rule.exceptions.some((e) => e.getTime() === date.getTime())) return false;
  if (inWeeklyPattern(rule, date)) return true;
  return (rule.monthlyRules ?? []).some((monthly) => monthlyRuleMatches(monthly, date));
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

/** One product line of a single weekday (`RecurringOrderDayItem`, NUD-171). */
export type DayItem = { weekday: number; productId: string; quantity: number };

/**
 * The product list of one delivery day (NUD-171): the weekday's own rows when the rule has any for
 * that weekday, otherwise the base list of the rule. Pure; the caller passes the rows it read.
 *
 * `schedule` is accepted so a caller reaches this the same way as `occursOn`, and it is deliberately
 * not part of the resolution: a weekday list wins for its weekday whether that weekday delivers
 * weekly or only through a monthly pattern (e.g. "every 1st Monday" with no weekly weekdays).
 */
export function itemsForWeekday(
  schedule: RecurringSchedule,
  weekday: number,
  baseItems: readonly { productId: string; quantity: number }[],
  dayItems: readonly DayItem[],
): { productId: string; quantity: number }[] {
  void schedule;
  const own = dayItems.filter((item) => item.weekday === weekday);
  if (own.length === 0) {
    return baseItems.map((i) => ({ productId: i.productId, quantity: i.quantity }));
  }
  const byProduct = new Map<string, number>();
  for (const item of own) {
    byProduct.set(item.productId, (byProduct.get(item.productId) ?? 0) + item.quantity);
  }
  return [...byProduct].map(([productId, quantity]) => ({ productId, quantity }));
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

/** Optional `YYYY-MM-DD`; empty, `null` and missing all mean "not set". */
const optionalDateText = z
  .string()
  .trim()
  .max(10)
  .nullish()
  .transform((v, ctx) => {
    if (v === null || v === undefined || v === "") return null;
    const d = parseCalendarDate(v);
    if (!d) ctx.addIssue({ code: "custom", message: "invalid date" });
    return d ?? null;
  });

/** Optional "HH:MM" (24 h); empty, `null` and missing all mean "all day". */
const timeText = z
  .string()
  .trim()
  .max(5)
  .nullish()
  .transform((v, ctx) => {
    if (v === null || v === undefined || v === "") return null;
    if (parseTimeOfDay(v) === null) {
      ctx.addIssue({ code: "custom", message: "invalid time" });
      return null;
    }
    return v.trim();
  });

const monthlyRuleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("dayOfMonth"), day: z.number().int().min(1).max(31) }).strict(),
  z
    .object({
      kind: z.literal("nthWeekday"),
      nth: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(-1)]),
      weekday: z.number().int().min(1).max(7),
    })
    .strict(),
]);

/**
 * The `monthlyRules` JSON array of a rule. Unknown kinds and extra keys are rejected (strict), the
 * array is de-duplicated and keeps its order.
 */
export const monthlyRulesSchema = z
  .array(monthlyRuleSchema)
  .max(MAX_MONTHLY_RULES)
  .default([])
  .transform((rules) => {
    const seen = new Set<string>();
    const out: MonthlyRule[] = [];
    for (const rule of rules) {
      const key = JSON.stringify(rule);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(rule);
    }
    return out;
  });

/**
 * Reads `monthlyRules` back from the database (`Json`). The migration only guarantees "an array of
 * at most ten", so anything the schema would reject is dropped: generation must not throw on a row
 * that older code or a manual edit left behind.
 */
export function parseMonthlyRules(value: unknown): MonthlyRule[] {
  const parsed = monthlyRulesSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

/**
 * Merges the day-item rows per weekday and product (like the base lines), weekdays ascending.
 * `null` when two rows of one weekday add up to more than `MAX_QUANTITY`.
 */
function mergeDayItems(items: readonly DayItem[]): DayItem[] | null {
  const byWeekday = new Map<number, { productId: string; quantity: number }[]>();
  for (const item of items) {
    const lines = byWeekday.get(item.weekday) ?? [];
    lines.push({ productId: item.productId, quantity: item.quantity });
    byWeekday.set(item.weekday, lines);
  }
  const out: DayItem[] = [];
  for (const weekday of [...byWeekday.keys()].sort((a, b) => a - b)) {
    const merged = mergeOrderLines(byWeekday.get(weekday) ?? []);
    if (!merged) return null;
    for (const line of merged) {
      out.push({ weekday, productId: line.productId, quantity: line.quantity });
    }
  }
  return out;
}

/** Input of the rule form (create and update). Validated again on the server. */
export const recurringOrderInputSchema = z
  .object({
    customerId: z.string().trim().min(1).max(64),
    /** Weekly weekdays; empty is allowed when `monthlyRules` carries at least one pattern. */
    weekdays: z
      .array(z.number().int().min(1).max(7))
      .max(7)
      .default([])
      .transform((days) => [...new Set(days)].sort((a, b) => a - b)),
    monthlyRules: monthlyRulesSchema,
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
    /** One connected skipped range (vacation), both or none (NUD-171). */
    skipFrom: optionalDateText,
    skipTo: optionalDateText,
    /** Delivery window time of every generated order, both or none (NUD-171); "from" < "to". */
    windowFromTime: timeText,
    windowToTime: timeText,
    /** End conditions (NUD-171): last delivery day and/or maximum number of deliveries. */
    endsOn: optionalDateText,
    maxDeliveries: z
      .number()
      .int()
      .min(1)
      .max(MAX_MAX_DELIVERIES)
      .nullish()
      .transform((v) => v ?? null),
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
    /** Per-weekday product lists; no rows for a weekday = the base `lines` (NUD-171). */
    dayItems: z
      .array(
        z.object({
          weekday: z.number().int().min(1).max(7),
          productId: z.string().trim().min(1).max(64),
          quantity: z.number().int().min(1).max(MAX_QUANTITY),
        }),
      )
      .max(MAX_DAY_ITEMS)
      .default([])
      .transform((items, ctx) => {
        const merged = mergeDayItems(items);
        if (!merged) ctx.addIssue({ code: "custom", message: "invalid day items" });
        return merged ?? [];
      }),
  })
  .refine((v) => (v.seasonFrom === null) === (v.seasonTo === null), { message: "season" })
  .refine((v) => v.weekdays.length > 0 || v.monthlyRules.length > 0, { message: "pattern" })
  .refine((v) => (v.windowFromTime === null) === (v.windowToTime === null), {
    message: "window",
  })
  .refine(
    (v) => {
      const from = v.windowFromTime === null ? null : parseTimeOfDay(v.windowFromTime);
      const to = v.windowToTime === null ? null : parseTimeOfDay(v.windowToTime);
      return from === null || to === null || from < to;
    },
    { message: "window" },
  )
  .refine((v) => (v.skipFrom === null) === (v.skipTo === null), { message: "skip" })
  .refine(
    (v) => v.skipFrom === null || v.skipTo === null || v.skipFrom.getTime() <= v.skipTo.getTime(),
    { message: "skip" },
  )
  .refine((v) => v.endsOn === null || v.endsOn.getTime() >= v.anchorDate.getTime(), {
    message: "endsOn",
  });

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
    const t = start + i * DAY_MS;
    if (rule.endsOn && t > rule.endsOn.getTime()) break;
    const day = new Date(t);
    if (occursOn(rule, day)) out.push(day);
  }
  return out;
}
