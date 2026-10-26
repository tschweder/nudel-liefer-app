import type { createFormatter } from "next-intl";

type Formatter = ReturnType<typeof createFormatter>;

/**
 * 24-hour clock for the driver screens (design review, point B).
 *
 * `Intl` renders zh-Hant-TW with a day period ("上午11:00", "下午03:15") while German shows "11:00"
 * and "15:15"; side by side the two locales drifted apart. `createAppFormatters().time` cannot take
 * options, so the driver app derives its clock from the same next-intl formatter with `hourCycle:
 * "h23"` — every locale shows "11:00" / "15:15" / "00:05", and the top-bar date stays locale-specific.
 */
export function driverTime(format: Formatter, timeZone: string) {
  return (value: Date) =>
    format.dateTime(value, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone });
}
