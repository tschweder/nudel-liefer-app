import { sumQuantities } from "./order-overview";

/**
 * Pure rules of the printable packing list / load sheet (NUD-091). The sheet is built from the
 * quantities the TOUR carries (`Stop.items`, what the office released), never from live orders.
 * No framework or database imports.
 */

export const LOAD_SHEET_UNIT_ORDER = ["KG", "PACK", "CRATE", "PIECE"] as const;

export type LoadSheetStopInput = {
  id: string;
  sequence: number;
  items: ReadonlyArray<{ productId: string; quantityCents: number }>;
};

export type LoadSheetProduct = { id: string; sku: string; unit: string; sortOrder: number };

export type LoadSheetTotal = { productId: string; unit: string; quantityCents: number };

const unitRank = (unit: string) => {
  const index = (LOAD_SHEET_UNIT_ORDER as readonly string[]).indexOf(unit);
  return index === -1 ? LOAD_SHEET_UNIT_ORDER.length : index;
};

/**
 * Section 1: one total per product and unit over ALL stops, using the shared aggregation
 * `sumQuantities` (the one the order overview uses). Different units are never added together.
 * Sorted by unit, then the catalog order (`sortOrder`, SKU).
 */
export function loadSheetTotals(
  stops: ReadonlyArray<Pick<LoadSheetStopInput, "items">>,
  products: ReadonlyArray<LoadSheetProduct>,
): LoadSheetTotal[] {
  const byId = new Map(products.map((p) => [p.id, p]));
  const lines = stops.flatMap((stop) =>
    stop.items.map((item) => ({
      productId: item.productId,
      unit: byId.get(item.productId)?.unit ?? "",
      quantityCents: item.quantityCents,
    })),
  );
  return sumQuantities(lines)
    .map((sum) => ({
      productId: sum.productId,
      unit: sum.unit ?? "",
      quantityCents: sum.quantityCents,
    }))
    .sort((a, b) => {
      const pa = byId.get(a.productId);
      const pb = byId.get(b.productId);
      return (
        unitRank(a.unit) - unitRank(b.unit) ||
        (pa?.sortOrder ?? 0) - (pb?.sortOrder ?? 0) ||
        (pa?.sku ?? "").localeCompare(pb?.sku ?? "") ||
        a.productId.localeCompare(b.productId)
      );
    });
}

/**
 * Section 2: the stops in LOAD order, i.e. reverse delivery order (the last stop is loaded first,
 * so the first stop is reachable last). `loadPosition` counts from 1.
 */
export function loadOrder<T extends Pick<LoadSheetStopInput, "sequence">>(
  stops: readonly T[],
): Array<T & { loadPosition: number }> {
  return [...stops]
    .sort((a, b) => b.sequence - a.sequence)
    .map((stop, index) => ({ ...stop, loadPosition: index + 1 }));
}
