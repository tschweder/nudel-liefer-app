/**
 * Delivery hours of a stop are free text typed by the office ("Mo–Fr 8–11 Uhr", "Mo-Sa 7-11 Uhr",
 * "nach Vereinbarung"). Only the weekday abbreviations and the "Uhr" suffix can be localized, so
 * those two parts go through message keys and the rest of the text stays exactly as stored.
 *
 * This is a presentation helper (redesign D4, run 3 review point 3: the Chinese locales showed
 * "Mo–Fr 8–11 Uhr" inside otherwise translated text). It changes neither the stored value nor any
 * server payload.
 */

const WEEKDAYS = {
  mo: "weekdayMo",
  di: "weekdayTu",
  mi: "weekdayWe",
  do: "weekdayTh",
  fr: "weekdayFr",
  sa: "weekdaySa",
  so: "weekdaySu",
} as const;

/** The message key of one weekday abbreviation, e.g. `"weekdayMo"`. */
export type WeekdayMessageKey = (typeof WEEKDAYS)[keyof typeof WEEKDAYS];

/** "Mo", "Mo.", "mo" — a weekday token, not part of a longer word ("Montag" is left alone). */
const WEEKDAY_PATTERN = /(^|[^\p{L}])(Mo|Di|Mi|Do|Fr|Sa|So)(\.?)(?!\p{L})/giu;
/** The German clock suffix ("8–11 Uhr", "8 - 11 Uhr"). */
const CLOCK_PATTERN = /(^|[^\p{L}])Uhr(?!\p{L})/giu;

/**
 * `day` returns the localized abbreviation for a weekday key ("weekdayMo"), `clock` the localized
 * word for "Uhr" (de keeps "Uhr", zh-Hans uses "时"). German text is returned unchanged, so the
 * e2e spec that reads "Mo-Fr 8-11 Uhr" keeps passing.
 */
export function localizeDeliveryHours(
  hours: string,
  day: (key: WeekdayMessageKey) => string,
  clock: string,
): string {
  return hours
    .replace(WEEKDAY_PATTERN, (_match, before: string, token: string, dot: string) => {
      const key = WEEKDAYS[token.toLowerCase() as keyof typeof WEEKDAYS];
      return key ? `${before}${day(key)}${dot}` : _match;
    })
    .replace(CLOCK_PATTERN, (_match, before: string) => `${before}${clock}`);
}
