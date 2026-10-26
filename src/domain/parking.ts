/**
 * Pure parking-spot rules (NUD-125, D22). A customer has a list of spots; the first active one by
 * `sortOrder` is the default and, from NUD-141 on, the routing and navigation point.
 */

export const PARKING_LABEL_MAX = 80;
export const PARKING_NOTE_MAX = 500;
/** Active spots per customer; more than a handful is a data-entry mistake, not a use case. */
export const PARKING_MAX_ACTIVE = 10;

export type ParkingSpotLike = { sortOrder: number; active: boolean };

/** Active spots in display order (stable for equal `sortOrder`). */
export function activeParkingSpots<T extends ParkingSpotLike>(spots: readonly T[]): T[] {
  return spots.filter((s) => s.active).sort((a, b) => a.sortOrder - b.sortOrder);
}

/** The default Parkplatz: the first active spot, or `null` when the customer has none. */
export function defaultParkingSpot<T extends ParkingSpotLike>(spots: readonly T[]): T | null {
  return activeParkingSpots(spots)[0] ?? null;
}

export type ParkingPointLike = ParkingSpotLike & { lat: number; lng: number };
export type RoutingPointSource = "parking" | "address";
export type RoutingPoint = { lat: number; lng: number; source: RoutingPointSource };

const isCoord = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value);

/**
 * The point a stop is optimised and navigated to (D22, NUD-141): the customer's default Parkplatz
 * (first active spot by `sortOrder`), else the geocoded Lieferadresse (`Customer.lat/lng`), else
 * `null` ("no location": only when geocoding failed and nobody set a point).
 */
export function routingPoint(customer: {
  lat: number | null;
  lng: number | null;
  parkingSpots: readonly ParkingPointLike[];
}): RoutingPoint | null {
  const spot = defaultParkingSpot(
    customer.parkingSpots.filter((s) => isCoord(s.lat) && isCoord(s.lng)),
  );
  if (spot) return { lat: spot.lat, lng: spot.lng, source: "parking" };
  if (isCoord(customer.lat) && isCoord(customer.lng)) {
    return { lat: customer.lat, lng: customer.lng, source: "address" };
  }
  return null;
}

/** Moves the element at `from` to `to` (both inside the list); returns a new array. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return [...items];
  }
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as T);
  return next;
}
