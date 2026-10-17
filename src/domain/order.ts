import { z } from "zod";

import { isScreenshotKey } from "@/lib/uploads";

/**
 * Pure order-entry rules (NUD-030): quantity parsing, line merging, input validation and the
 * non-blocking warnings. No framework or database imports.
 */

/** `Decimal(10,2)`: at most 8 integer digits and 2 decimals. */
export const MAX_QUANTITY_CENTS = 9_999_999_999;
export const MAX_ORDER_LINES = 100;
export const MAX_NOTE_LENGTH = 1000;

/**
 * Parses what an office user types into a quantity in hundredths (cents), or `null`.
 * Accepts `,` and `.` as decimal separator and at most two decimals. A third decimal is
 * rejected, not rounded or guessed: "1.000" could mean 1 or 1000, and a wrong delivery quantity
 * is worse than a rejected input. Thousands separators are not supported. Zero is valid here;
 * "greater than zero" is checked by the callers.
 */
export function parseQuantityCents(input: string | number): number | null {
  const text = typeof input === "number" ? (Number.isFinite(input) ? String(input) : "") : input;
  const match = /^(\d{1,8})(?:[.,](\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  return whole * 100 + fraction;
}

/** Quantity as a number (e.g. `2.5`) for input in `,` or `.` notation, `null` if invalid or <= 0. */
export function parseQuantity(input: string | number): number | null {
  const cents = parseQuantityCents(input);
  return cents === null || cents <= 0 ? null : cents / 100;
}

/** Hundredths to the plain decimal string stored in `Decimal(10,2)`, e.g. 250 -> "2.50". */
export function centsToDecimal(cents: number): string {
  const whole = Math.trunc(cents / 100);
  const fraction = String(cents % 100).padStart(2, "0");
  return `${whole}.${fraction}`;
}

export type OrderLine = { productId: string; quantityCents: number };

/**
 * Decision (backlog §9): the same product twice in one order is MERGED (quantities added),
 * not rejected. Order of first appearance is kept. Returns `null` if the sum no longer fits
 * `Decimal(10,2)`.
 */
export function mergeOrderLines(lines: readonly OrderLine[]): OrderLine[] | null {
  const merged = new Map<string, number>();
  for (const line of lines) {
    const sum = (merged.get(line.productId) ?? 0) + line.quantityCents;
    if (sum > MAX_QUANTITY_CENTS) return null;
    merged.set(line.productId, sum);
  }
  return [...merged].map(([productId, quantityCents]) => ({ productId, quantityCents }));
}

/** True if at least one product appears more than once (the form tells the user it will be merged). */
export function hasDuplicateProducts(productIds: readonly string[]): boolean {
  return new Set(productIds).size !== productIds.length;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` to a `DATE` value (UTC midnight); `null` for anything that is not a real day. */
export function parseCalendarDate(value: string): Date | null {
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return date;
}

/** A `DATE` value (UTC midnight) as `YYYY-MM-DD`. */
export function formatCalendarDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Orders for days before `today` (both UTC midnight `DATE` values) are not accepted. */
export function isPastDeliveryDate(date: Date, today: Date): boolean {
  return date.getTime() < today.getTime();
}

const idSchema = z.string().trim().min(1).max(64);

const quantitySchema = z.union([z.string().max(32), z.number()]).transform((value, ctx) => {
  const cents = parseQuantityCents(value);
  if (cents === null || cents <= 0) {
    ctx.addIssue({ code: "custom", message: "quantity" });
    return z.NEVER;
  }
  return cents;
});

/**
 * Input of "create order". Quantities may be strings with `,` or `.`; the output has merged
 * lines with exact quantities in hundredths. At least one line, every quantity > 0.
 */
export const orderInputSchema = z
  .object({
    customerId: idSchema,
    deliveryDate: z
      .string()
      .trim()
      .transform((value, ctx) => {
        const date = parseCalendarDate(value);
        if (!date) {
          ctx.addIssue({ code: "custom", message: "deliveryDate" });
          return z.NEVER;
        }
        return date;
      }),
    status: z.enum(["CONFIRMED", "DRAFT"]).default("CONFIRMED"),
    internalNote: z
      .string()
      .trim()
      .max(MAX_NOTE_LENGTH)
      .nullish()
      .transform((v) => (v ? v : null)),
    /**
     * Optional screenshot the order was typed from (NUD-031): a key issued by `POST /api/uploads`
     * for purpose `screenshot`. Its presence makes the order `source=SCREENSHOT`; the client
     * cannot choose the source otherwise.
     */
    screenshotKey: z
      .string()
      .max(200)
      .refine(isScreenshotKey)
      .nullish()
      .transform((v) => v ?? null),
    lines: z
      .array(z.object({ productId: idSchema, quantity: quantitySchema }))
      .min(1)
      .max(MAX_ORDER_LINES),
  })
  .transform((value, ctx) => {
    const merged = mergeOrderLines(
      value.lines.map((l) => ({ productId: l.productId, quantityCents: l.quantity })),
    );
    if (!merged) {
      ctx.addIssue({ code: "custom", message: "quantity" });
      return z.NEVER;
    }
    return { ...value, lines: merged };
  });

export type OrderInput = z.input<typeof orderInputSchema>;
export type ValidOrder = z.output<typeof orderInputSchema>;

export type OrderWarning = "combined_stop" | "pin_unconfirmed";

/**
 * Warnings (never errors) shown while entering an order: the customer already has confirmed
 * orders that day (they become one stop), or the pin is unconfirmed (cannot be routed).
 */
export function orderWarnings(input: {
  pinConfirmed: boolean;
  confirmedOrdersOnDate: number;
}): OrderWarning[] {
  const warnings: OrderWarning[] = [];
  if (input.confirmedOrdersOnDate > 0) warnings.push("combined_stop");
  if (!input.pinConfirmed) warnings.push("pin_unconfirmed");
  return warnings;
}
