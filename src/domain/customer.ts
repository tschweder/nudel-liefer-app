/**
 * Pure customer rules (no framework imports): address comparison and the suggested next
 * customer number. Used by the server mutations and by the form, so the UI
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

/**
 * Free-text address for the geocoder: "street, postal code city, country" (empty parts left out),
 * cut to `maxLength` characters. The customer form and the import use the same text.
 */
export function addressQuery(address: CustomerAddress, maxLength = 300): string {
  return [address.street, `${address.postalCode} ${address.city}`, address.country]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ")
    .slice(0, maxLength);
}
