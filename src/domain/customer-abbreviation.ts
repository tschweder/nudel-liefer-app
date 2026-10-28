/**
 * Pure rules of the customer Abkürzung (NUD-164, D27). A legacy internal code of the old system:
 * free text with special characters, optional, NOT unique, no logic. Drivers see it to find their
 * way until the new system is adopted; then the field is removed again.
 */

/** Longest Abkürzung (characters). */
export const ABBREVIATION_MAX = 20;

/** The stored shape: surrounding spaces dropped, blank = `null`. `undefined` when too long. */
export function normalizeAbbreviation(input: string | null | undefined): string | null | undefined {
  const raw = input?.trim() ?? "";
  if (raw.length > ABBREVIATION_MAX) return undefined;
  return raw === "" ? null : raw;
}
