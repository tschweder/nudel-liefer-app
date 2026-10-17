/**
 * Pure customer-photo rules. The "photos missing" flag is derived, never stored: a customer is
 * flagged when it lacks a current STORE or a current PARKING photo (D12). The customer list
 * filter (`customers.ts`, SQL) implements the same rule; an integration test keeps them equal.
 */

export const PHOTO_KINDS = ["STORE", "PARKING"] as const;
export type PhotoKind = (typeof PHOTO_KINDS)[number];

export function photosMissing(currentKinds: Iterable<PhotoKind>): boolean {
  const kinds = new Set(currentKinds);
  return !PHOTO_KINDS.every((kind) => kinds.has(kind));
}
