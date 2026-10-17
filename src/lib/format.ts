import type { createFormatter } from "next-intl";

type Formatter = ReturnType<typeof createFormatter>;

/** Fallback when `Settings.timezone` cannot be read; the real value is stored in Settings (backlog 4.3). */
export const DEFAULT_TIMEZONE = "Europe/Vienna";

/**
 * Locale-aware formatting helpers on top of a next-intl formatter
 * (`useFormatter()` in components, `await getFormatter()` in async server code).
 */
export function createAppFormatters(format: Formatter, timeZone: string = DEFAULT_TIMEZONE) {
  return {
    /** Quantities: `Decimal(10,2)` shown without trailing zeros (`5`, `2.5`). */
    quantity: (value: number | string) =>
      format.number(Number(value), { minimumFractionDigits: 0, maximumFractionDigits: 2 }),
    /** A moment in time, shown in the factory time zone, e.g. "Mo., 17. Okt.". */
    dateShort: (value: Date) =>
      format.dateTime(value, { weekday: "short", day: "numeric", month: "short", timeZone }),
    dateLong: (value: Date) =>
      format.dateTime(value, { weekday: "long", day: "numeric", month: "long", timeZone }),
    dateTime: (value: Date) =>
      format.dateTime(value, { dateStyle: "medium", timeStyle: "short", timeZone }),
    time: (value: Date) => format.dateTime(value, { hour: "2-digit", minute: "2-digit", timeZone }),
    /**
     * A `DATE` column value such as `deliveryDate` (a calendar day without time zone).
     * Always formatted in UTC so the day never shifts.
     */
    calendarDate: (value: Date) => format.dateTime(value, { dateStyle: "medium", timeZone: "UTC" }),
  };
}

export type AppFormatters = ReturnType<typeof createAppFormatters>;
