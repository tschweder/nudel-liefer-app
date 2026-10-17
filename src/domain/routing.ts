/**
 * Pure routing algorithms (no framework imports): great-circle distance, the heuristic distance
 * and duration model, nearest-neighbour and 2-opt. Used by the local fallback of the
 * `RoutingProvider` (NUD-040). Index 0 of every matrix is the depot.
 */

export type LatLng = { lat: number; lng: number };

/** Factor applied to the straight-line distance to approximate road distance (D9 fallback). */
export const ROAD_FACTOR = 1.3;
/** Average driving speed of the fallback, in km/h. */
export const AVERAGE_SPEED_KMH = 30;

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance in metres. */
export function haversineM(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Estimated road distance between two points: haversine x road factor, in metres. */
export function estimatedRoadDistanceM(a: LatLng, b: LatLng): number {
  return haversineM(a, b) * ROAD_FACTOR;
}

/** Driving time in seconds for a road distance at the fallback's average speed. */
export function estimatedDurationS(distanceM: number): number {
  return distanceM / ((AVERAGE_SPEED_KMH * 1000) / 3600);
}

/** Symmetric matrix of estimated road distances (metres); `points[0]` is the depot. */
export function distanceMatrix(points: readonly LatLng[]): number[][] {
  return points.map((a) => points.map((b) => (a === b ? 0 : estimatedRoadDistanceM(a, b))));
}

/** Length of the closed tour `0 -> order[0] -> ... -> order[n-1] -> 0`. */
export function tourLength(dist: readonly (readonly number[])[], order: readonly number[]): number {
  let total = 0;
  let prev = 0;
  for (const node of order) {
    total += dist[prev]![node]!;
    prev = node;
  }
  return total + dist[prev]![0]!;
}

/**
 * Nearest-neighbour construction starting at the depot (node 0). Returns the visiting order of
 * nodes `1..n-1`. Ties go to the lowest index so the result is deterministic.
 */
export function nearestNeighbourOrder(dist: readonly (readonly number[])[]): number[] {
  const n = dist.length;
  const remaining = new Set<number>();
  for (let i = 1; i < n; i++) remaining.add(i);
  const order: number[] = [];
  let current = 0;
  while (remaining.size > 0) {
    let best = -1;
    let bestDist = Infinity;
    for (const candidate of [...remaining].sort((a, b) => a - b)) {
      const d = dist[current]![candidate]!;
      if (d < bestDist) {
        bestDist = d;
        best = candidate;
      }
    }
    order.push(best);
    remaining.delete(best);
    current = best;
  }
  return order;
}

/**
 * 2-opt improvement of a closed tour that starts and ends at the depot (node 0, not part of
 * `order`). Reverses segments while that shortens the tour; stops at a local optimum. Requires a
 * symmetric matrix. Returns a new array; never longer than the input.
 */
export function twoOpt(dist: readonly (readonly number[])[], order: readonly number[]): number[] {
  const path = [0, ...order, 0];
  const last = path.length - 1;
  const EPS = 1e-9;
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < last - 1; i++) {
      for (let j = i + 1; j < last; j++) {
        // Replace edges (i-1,i) and (j,j+1) by (i-1,j) and (i,j+1).
        const a = path[i - 1]!;
        const b = path[i]!;
        const c = path[j]!;
        const d = path[j + 1]!;
        const delta = dist[a]![c]! + dist[b]![d]! - dist[a]![b]! - dist[c]![d]!;
        if (delta < -EPS) {
          const reversed = path.slice(i, j + 1).reverse();
          path.splice(i, j - i + 1, ...reversed);
          improved = true;
        }
      }
    }
  }
  return path.slice(1, last);
}

export type HeuristicLeg = { distanceM: number; durationS: number };

/** Legs (depot -> stops in order -> depot) for an ordered list of points, rounded to whole units. */
export function estimateLegs(depot: LatLng, ordered: readonly LatLng[]): HeuristicLeg[] {
  const path = [depot, ...ordered, depot];
  const legs: HeuristicLeg[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const distance = estimatedRoadDistanceM(path[i]!, path[i + 1]!);
    legs.push({
      distanceM: Math.round(distance),
      durationS: Math.round(estimatedDurationS(distance)),
    });
  }
  return legs;
}

/** Visiting order (indices into `stops`) by nearest-neighbour followed by 2-opt. */
export function heuristicOrder(depot: LatLng, stops: readonly LatLng[]): number[] {
  if (stops.length === 0) return [];
  const dist = distanceMatrix([depot, ...stops]);
  return twoOpt(dist, nearestNeighbourOrder(dist)).map((node) => node - 1);
}
