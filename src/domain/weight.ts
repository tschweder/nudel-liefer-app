/**
 * Weight of order lines (NUD-138). A product weighs `weightKgPerUnit` kg per unit (Sackerl, Kiste
 * or piece), so a line weighs `quantity × weightKgPerUnit`. Used for the vehicle capacity (NUD-146).
 */

export type WeightedProduct = { id: string; weightKgPerUnit: number | string };
export type WeightedLine = { productId: string; quantity: number };

/** Largest weight per unit an admin may enter (kg); keeps `Decimal(6,2)` far from overflow. */
export const MAX_WEIGHT_KG_PER_UNIT = 9999.99;

/** Parses a weight per unit typed with a decimal comma or point; `null` unless it is > 0 and ≤ 9999.99. */
export function parseWeightKg(input: string | number): number | null {
  const text = typeof input === "number" ? String(input) : input.trim().replace(",", ".");
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(text)) return null;
  const value = Number(text);
  return value > 0 && value <= MAX_WEIGHT_KG_PER_UNIT ? value : null;
}

/**
 * Total weight in kg of `items`, rounded to 2 decimals. Computed in hundredths of a kilogram so
 * 0.1 + 0.2 style float errors cannot appear. A line whose product is unknown counts as 0 kg.
 */
export function orderWeightKg(
  items: readonly WeightedLine[],
  products: readonly WeightedProduct[],
): number {
  const hundredths = new Map(
    products.map((p) => [p.id, Math.round(Number(p.weightKgPerUnit) * 100)]),
  );
  let total = 0;
  for (const item of items) total += (hundredths.get(item.productId) ?? 0) * item.quantity;
  return total / 100;
}
