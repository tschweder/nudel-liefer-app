/**
 * Pure customer rules (no framework imports): pin confirmation after address changes and the
 * suggested next customer number. Used by the server mutations and by the form, so the UI
 * enforces exactly what the server enforces.
 */

export type CustomerAddress = {
  street: string;
  postalCode: string;
  city: string;
  country: string;
};

export type Pin = { lat: number; lng: number };

const norm = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();

/** True when the delivery address differs (case/whitespace-insensitive). The name is not part of it. */
export function addressChanged(before: CustomerAddress, after: CustomerAddress): boolean {
  return (
    norm(before.street) !== norm(after.street) ||
    norm(before.postalCode) !== norm(after.postalCode) ||
    norm(before.city) !== norm(after.city) ||
    norm(before.country) !== norm(after.country)
  );
}

export function samePin(a: Pin | null, b: Pin | null): boolean {
  if (a === null || b === null) return a === b;
  return a.lat === b.lat && a.lng === b.lng;
}

/**
 * May the admin confirm the pin for this form state? Needs a pin; and once the address of an
 * existing customer was changed, the pin must have been moved or searched again (a confirmation
 * given for the old address says nothing about the new one). `before` is `null` for a new customer.
 */
export function canConfirmPin(
  before: { address: CustomerAddress; pin: Pin | null } | null,
  after: { address: CustomerAddress; pin: Pin | null },
): boolean {
  if (after.pin === null) return false;
  if (before === null) return true;
  if (!addressChanged(before.address, after.address)) return true;
  return !samePin(before.pin, after.pin);
}

/**
 * The `pinConfirmed` value to store: the admin's explicit confirmation, but only where
 * `canConfirmPin` allows it. Changing the address without moving the pin therefore resets it.
 */
export function resolvePinConfirmed(
  requested: boolean,
  before: { address: CustomerAddress; pin: Pin | null } | null,
  after: { address: CustomerAddress; pin: Pin | null },
): boolean {
  return requested && canConfirmPin(before, after);
}

/**
 * Suggests the next free customer number: the highest number that ends in digits, plus one,
 * keeping its prefix and zero padding ("K-0099" -> "K-0100", "1041" -> "1042"). Falls back to
 * "1001" when no number ends in digits.
 */
export function suggestNextCustomerNumber(existing: readonly string[]): string {
  let best: { prefix: string; digits: string; value: number } | null = null;
  for (const raw of existing) {
    const match = /^(.*?)(\d{1,15})$/.exec(raw.trim());
    if (!match) continue;
    const value = Number(match[2]!);
    if (best === null || value > best.value) {
      best = { prefix: match[1]!, digits: match[2]!, value };
    }
  }
  if (best === null) return "1001";
  const next = String(best.value + 1).padStart(best.digits.length, "0");
  return `${best.prefix}${next}`;
}
