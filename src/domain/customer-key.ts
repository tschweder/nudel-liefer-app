/**
 * Pure rules of the customer key (NUD-142, D27). The factory may hold a key to a shop; the office
 * and the drivers record whether there is one and its number. `hasKey` is a tri-state: `null` =
 * unknown (the driver is asked), `true` = a key exists, `false` = there is none.
 */

/** Longest key number (characters). */
export const KEY_NUMBER_MAX = 20;

export type CustomerKey = { hasKey: boolean | null; keyNumber: string | null };

/**
 * The stored shape of a key entry: a number only exists while `hasKey` is true, blank text is
 * `null`, surrounding spaces are dropped. `null` when the number is too long.
 */
export function normalizeKey(input: {
  hasKey: boolean | null;
  keyNumber?: string | null;
}): CustomerKey | null {
  const raw = input.keyNumber?.trim() ?? "";
  if (raw.length > KEY_NUMBER_MAX) return null;
  if (input.hasKey !== true) return { hasKey: input.hasKey, keyNumber: null };
  return { hasKey: true, keyNumber: raw === "" ? null : raw };
}

export function sameKey(a: CustomerKey, b: CustomerKey): boolean {
  return a.hasKey === b.hasKey && a.keyNumber === b.keyNumber;
}

/** How the driver sees the key: `unknown` (chip "?"), `none`, `number` or `present` (no number noted). */
export type KeyDisplay =
  { kind: "unknown" } | { kind: "none" } | { kind: "present" } | { kind: "number"; number: string };

export function keyDisplay(key: {
  hasKey?: boolean | null;
  keyNumber?: string | null;
}): KeyDisplay {
  if (key.hasKey === true) {
    const number = key.keyNumber?.trim();
    return number ? { kind: "number", number } : { kind: "present" };
  }
  return key.hasKey === false ? { kind: "none" } : { kind: "unknown" };
}
