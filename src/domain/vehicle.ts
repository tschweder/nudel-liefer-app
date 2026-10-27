/**
 * Vehicles and tour load (NUD-146, D24). A tour carries the weight of the quantities on its stops
 * (`orderWeightKg`, NUD-138) and a vehicle has a capacity in whole kilograms. Pure: no framework
 * imports.
 */
import { orderWeightKg, type WeightedLine, type WeightedProduct } from "./weight";

/** Largest capacity an admin may enter (kg); far above any delivery van, keeps the column sane. */
export const MAX_CAPACITY_KG = 50_000;

/** Parses a capacity in whole kilograms ("1200", " 800 "); `null` unless it is an integer in 1..50000. */
export function parseCapacityKg(input: string | number): number | null {
  const text = typeof input === "number" ? String(input) : input.trim();
  if (!/^\d{1,5}$/.test(text)) return null;
  const value = Number(text);
  return value >= 1 && value <= MAX_CAPACITY_KG ? value : null;
}

/** Total weight in kg of every line on every stop of a tour (stop snapshots, one list per stop). */
export function tourLoadKg(
  stopItems: ReadonlyArray<readonly WeightedLine[]>,
  products: readonly WeightedProduct[],
): number {
  return orderWeightKg(stopItems.flat(), products);
}

export type LoadState = {
  /** `none`: no vehicle yet, so there is nothing to compare with. */
  status: "none" | "ok" | "over";
  loadKg: number;
  capacityKg: number | null;
  /** Kilograms above the capacity (0 unless `over`). */
  overKg: number;
  /** Load as a share of the capacity, rounded, not capped (130 = 30 % over); 0 without a vehicle. */
  percent: number;
};

/** Compares a tour's load with its vehicle's capacity. Exactly the capacity is still fine. */
export function loadState(loadKg: number, capacityKg: number | null): LoadState {
  if (capacityKg === null || capacityKg <= 0) {
    return { status: "none", loadKg, capacityKg: null, overKg: 0, percent: 0 };
  }
  const overKg = Math.max(0, Math.round((loadKg - capacityKg) * 100) / 100);
  return {
    status: overKg > 0 ? "over" : "ok",
    loadKg,
    capacityKg,
    overKg,
    percent: Math.round((loadKg / capacityKg) * 100),
  };
}

/**
 * The worst trip of a tour against the capacity of the vehicle that drives it (NUD-147, NUD-158:
 * after a vehicle switch a trip has another vehicle). The most overloaded trip wins, otherwise the
 * fullest one. A trip without a known capacity is not compared; with none at all the state is
 * `none` with the heaviest trip as the load.
 */
export function worstTripLoad(
  tripLoadsKg: readonly number[],
  tripCapacitiesKg: ReadonlyArray<number | null>,
): LoadState & { trip: number } {
  let worst: (LoadState & { trip: number }) | null = null;
  tripLoadsKg.forEach((loadKg, index) => {
    const state = loadState(loadKg, tripCapacitiesKg[index] ?? null);
    if (state.status === "none") return;
    if (
      !worst ||
      state.overKg > worst.overKg ||
      (state.overKg === worst.overKg && state.percent > worst.percent)
    ) {
      worst = { ...state, trip: index + 1 };
    }
  });
  if (worst) return worst;
  const heaviest = tripLoadsKg.length > 0 ? Math.max(...tripLoadsKg) : 0;
  return { ...loadState(heaviest, null), trip: Math.max(1, tripLoadsKg.indexOf(heaviest) + 1) };
}
