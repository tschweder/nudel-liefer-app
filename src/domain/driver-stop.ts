/**
 * Pure rules of the driver's stop detail screen (NUD-052).
 */

/** Previous and next stop of `stopId` in tour order (sequence), regardless of their status. */
export function neighbourStops<T extends { id: string; sequence: number }>(
  stops: readonly T[],
  stopId: string,
): { position: number; total: number; prev: T | null; next: T | null } | null {
  const sorted = [...stops].sort((a, b) => a.sequence - b.sequence);
  const index = sorted.findIndex((s) => s.id === stopId);
  if (index < 0) return null;
  return {
    position: index + 1,
    total: sorted.length,
    prev: sorted[index - 1] ?? null,
    next: sorted[index + 1] ?? null,
  };
}

/** One line "street, postal code city" (the customer address is never translated). */
export function formatAddress(a: { street: string; postalCode: string; city: string }): string {
  return `${a.street}, ${a.postalCode} ${a.city}`.trim();
}
