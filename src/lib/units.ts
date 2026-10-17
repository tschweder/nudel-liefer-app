/** Product units (Prisma enum `Unit`); a plain list so client code does not import the DB layer. */
export const UNITS = ["KG", "PACK", "CRATE", "PIECE"] as const;
export type UnitValue = (typeof UNITS)[number];
