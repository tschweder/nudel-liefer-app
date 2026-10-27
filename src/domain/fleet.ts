/**
 * Several tours per day and reload trips (NUD-147, D24). Pure rules: split the stops of a day
 * across the selected vehicles by capacity (kg), pack what does not fit into reload trips at the
 * depot, keep trip numbers consistent when a tour is edited, and compute the schedule of a tour
 * with reloads. No framework imports.
 */
import { haversineM, heuristicOrder, type LatLng } from "./routing";

/** Time the vehicle stands at the depot to reload between two trips (seconds). */
export const RELOAD_MINUTES = 20;
export const RELOAD_SECONDS = RELOAD_MINUTES * 60;

export type FleetStop = {
  id: string;
  location: LatLng;
  weightKg: number;
  /** Time-of-day window in seconds since midnight (NUD-148); only the optimiser uses it. */
  timeWindow?: { fromS: number; toS: number };
};
export type FleetVehicle = { id: string; capacityKg: number };

export type FleetRoute = { vehicleId: string; stopIds: string[] };
export type FleetSplit = { routes: FleetRoute[]; unassigned: string[] };

/**
 * Sweep order: the stops sorted by their angle around the depot, starting after the widest empty
 * angular gap, so neighbouring stops end up next to each other. Ties go to the nearer stop, then
 * to the id (deterministic).
 */
export function sweepOrder<T extends { id: string; location: LatLng }>(
  depot: LatLng,
  stops: readonly T[],
): T[] {
  if (stops.length <= 1) return [...stops];
  const keyed = stops
    .map((stop) => ({
      stop,
      angle: Math.atan2(stop.location.lat - depot.lat, stop.location.lng - depot.lng),
      distance: haversineM(depot, stop.location),
    }))
    .sort(
      (a, b) => a.angle - b.angle || a.distance - b.distance || a.stop.id.localeCompare(b.stop.id),
    );
  // Start after the widest gap between two neighbouring angles (including the wrap-around).
  let widest = -1;
  let startIndex = 0;
  for (let i = 0; i < keyed.length; i++) {
    const next = keyed[(i + 1) % keyed.length]!;
    const gap = (next.angle - keyed[i]!.angle + 2 * Math.PI) % (2 * Math.PI);
    if (gap > widest + 1e-12) {
      widest = gap;
      startIndex = (i + 1) % keyed.length;
    }
  }
  return [...keyed.slice(startIndex), ...keyed.slice(0, startIndex)].map((k) => k.stop);
}

/** Fills one trip of `capacityKg` from `remaining` (in order); returns the taken stops. */
function fillTrip<T extends { weightKg: number }>(
  remaining: T[],
  capacityKg: number,
): { taken: T[]; rest: T[] } {
  const taken: T[] = [];
  const rest: T[] = [];
  let load = 0;
  for (const stop of remaining) {
    if (load + stop.weightKg <= capacityKg) {
      taken.push(stop);
      load += stop.weightKg;
    } else rest.push(stop);
  }
  return { taken, rest };
}

/**
 * Capacity-aware greedy split (the heuristic fallback of the VROOM distribution): vehicles are
 * filled one after the other, largest capacity first, each along the sweep order. A vehicle that
 * is not needed gets no route. What fits into no vehicle is returned in `unassigned` (reload
 * trips, `packReloadTrips`). Stop order inside a route is the sweep order; the caller orders it.
 */
export function splitByCapacity(
  depot: LatLng,
  stops: readonly FleetStop[],
  vehicles: readonly FleetVehicle[],
): FleetSplit {
  const byCapacity = vehicles
    .map((vehicle, index) => ({ vehicle, index }))
    .sort((a, b) => b.vehicle.capacityKg - a.vehicle.capacityKg || a.index - b.index);
  let remaining = sweepOrder(depot, stops);
  const routes: FleetRoute[] = [];
  for (const { vehicle } of byCapacity) {
    if (remaining.length === 0) break;
    const { taken, rest } = fillTrip(remaining, vehicle.capacityKg);
    if (taken.length === 0) continue;
    routes.push({ vehicleId: vehicle.id, stopIds: taken.map((s) => s.id) });
    remaining = rest;
  }
  return { routes, unassigned: remaining.map((s) => s.id) };
}

/**
 * Reload trips for the stops that fit into no vehicle's first trip. Each new trip goes to the
 * vehicle with the fewest trips so far (then the larger one) and is filled along the sweep order.
 * A stop heavier than any capacity gets a trip of its own (`oversized`; the load indicator turns
 * red, the release needs the override). `tripCounts` = trips each vehicle already has.
 */
export function packReloadTrips(
  depot: LatLng,
  vehicles: readonly FleetVehicle[],
  tripCounts: ReadonlyMap<string, number>,
  leftovers: readonly FleetStop[],
): { trips: FleetRoute[]; oversized: string[] } {
  const counts = new Map(vehicles.map((v) => [v.id, tripCounts.get(v.id) ?? 0]));
  const trips: FleetRoute[] = [];
  const oversized: string[] = [];
  let remaining = sweepOrder(depot, leftovers);
  while (remaining.length > 0) {
    const vehicle = [...vehicles].sort(
      (a, b) =>
        counts.get(a.id)! - counts.get(b.id)! ||
        b.capacityKg - a.capacityKg ||
        vehicles.indexOf(a) - vehicles.indexOf(b),
    )[0];
    if (!vehicle) break;
    const { taken, rest } = fillTrip(remaining, vehicle.capacityKg);
    if (taken.length === 0) {
      // Heavier than the vehicle: a trip of its own, flagged.
      const [first, ...others] = remaining;
      oversized.push(first!.id);
      trips.push({ vehicleId: vehicle.id, stopIds: [first!.id] });
      remaining = others;
    } else {
      trips.push({ vehicleId: vehicle.id, stopIds: taken.map((s) => s.id) });
      remaining = rest;
    }
    counts.set(vehicle.id, counts.get(vehicle.id)! + 1);
  }
  return { trips, oversized };
}

/** Visiting order of one trip (nearest neighbour + 2-opt) as stop ids. */
export function orderTrip(depot: LatLng, stops: readonly FleetStop[]): string[] {
  return heuristicOrder(
    depot,
    stops.map((s) => s.location),
  ).map((i) => stops[i]!.id);
}

/**
 * Trip numbers for stops in tour order: never decreasing and without gaps (1, 1, 2, 2, 3). Used
 * after any edit so a tour never has an empty trip or trips out of order.
 */
export function normalizeTrips(trips: readonly number[]): number[] {
  let highest = 1;
  let current = 0;
  let previousHighest = 0;
  return trips.map((raw, index) => {
    highest = Math.max(highest, Number.isFinite(raw) ? Math.floor(raw) : 1);
    if (index === 0) current = 1;
    else if (highest !== previousHighest) current += 1;
    previousHighest = highest;
    return current;
  });
}

/** Stop indices grouped by trip, in tour order (`trips` must be normalized). */
export function groupByTrip<T>(items: readonly T[], trips: readonly number[]): T[][] {
  const groups: T[][] = [];
  let last = -1;
  items.forEach((item, index) => {
    const trip = trips[index] ?? 1;
    if (trip !== last) {
      groups.push([]);
      last = trip;
    }
    groups[groups.length - 1]!.push(item);
  });
  return groups;
}

/** Kilograms per trip (index 0 = trip 1) from the weight of every stop and its trip number. */
export function tripLoadsKg(stops: ReadonlyArray<{ trip: number; weightKg: number }>): number[] {
  const trips = normalizeTrips(stops.map((s) => s.trip));
  const loads: number[] = [];
  stops.forEach((stop, index) => {
    const slot = trips[index]! - 1;
    loads[slot] = Math.round(((loads[slot] ?? 0) + stop.weightKg) * 100) / 100;
  });
  return loads;
}

export type TripSchedule = {
  /** Arrival time per stop, in tour order. */
  etas: Date[];
  /** When the vehicle is back at the depot for each reload (one entry per reload). */
  reloadAt: Date[];
  /** Back at the depot after the last trip. */
  returnAt: Date;
  /** Driving, service and reload time, depot to depot, in seconds. */
  totalDurationS: number;
};

/**
 * ETAs of a tour with reload trips. `trips[k]` holds the legs into its stops and the leg back to
 * the depot. Every reload adds `reloadSeconds` at the depot. For one trip this equals
 * `computeSchedule` (`domain/tour.ts`).
 */
export function computeTripSchedule(input: {
  departure: Date;
  trips: ReadonlyArray<{ stopLegDurationsS: readonly number[]; returnLegDurationS: number }>;
  serviceSecondsPerStop: number;
  reloadSeconds?: number;
}): TripSchedule {
  const { departure, trips, serviceSecondsPerStop } = input;
  const reloadSeconds = input.reloadSeconds ?? RELOAD_SECONDS;
  const at = (seconds: number) => new Date(departure.getTime() + seconds * 1000);
  const etas: Date[] = [];
  const reloadAt: Date[] = [];
  let elapsed = 0;
  trips.forEach((trip, index) => {
    for (const leg of trip.stopLegDurationsS) {
      elapsed += leg;
      etas.push(at(elapsed));
      elapsed += serviceSecondsPerStop;
    }
    if (trip.stopLegDurationsS.length > 0) elapsed += trip.returnLegDurationS;
    if (index < trips.length - 1) {
      reloadAt.push(at(elapsed));
      elapsed += reloadSeconds;
    }
  });
  return { etas, reloadAt, returnAt: at(elapsed), totalDurationS: elapsed };
}
