/** Product units (Prisma enum `Unit`); a plain list so client code does not import the DB layer. */
export const UNITS = ["KG", "PACK", "CRATE", "PIECE"] as const;
export type UnitValue = (typeof UNITS)[number];

/**
 * `PIECE` has no unit word (D23, glossary §3): the line reads "3 × Wantan-Teig". All other units
 * read "22 Sackerl Nudeln" / "14 Kiste Nudeln" (quantity, unit word, product name).
 */
export function isPieceUnit(unit: string): boolean {
  return unit === "PIECE";
}
