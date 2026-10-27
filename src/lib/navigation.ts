/**
 * Deep links that start navigation in Google Maps (opens the app when installed, works on Android
 * and iOS). Always built from coordinates, never from the address string (D16).
 */
type Point = { lat: number; lng: number };

export function googleMapsNavigationUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
}

/** Apple Maps directions to one point (offered additionally on iOS). */
export function appleMapsNavigationUrl(lat: number, lng: number): string {
  return `https://maps.apple.com/?daddr=${lat},${lng}`;
}

type NavigationStop = {
  /** Routing point: default Parkplatz, else the address point (D22). */
  lat: number | null;
  lng: number | null;
  addressLat?: number | null;
  addressLng?: number | null;
  parkingSpots?: readonly Point[];
};

const isPoint = (lat: number | null | undefined, lng: number | null | undefined): boolean =>
  typeof lat === "number" && typeof lng === "number";

/**
 * The one "Navigation starten" link of a stop (D30). With a Parkplatz: the Parkplatz is a
 * `waypoints` stop and the Lieferadresse the `destination` (park first, entrance second; one
 * travel mode for the whole route). Without a Parkplatz, or when the address point is unknown: the
 * single point. Returns `null` when the stop has no location at all.
 */
export function stopGoogleNavigationUrl(stop: NavigationStop): string | null {
  const park = stop.parkingSpots?.[0];
  const address = isPoint(stop.addressLat, stop.addressLng)
    ? { lat: stop.addressLat as number, lng: stop.addressLng as number }
    : null;
  if (park && address) {
    return `https://www.google.com/maps/dir/?api=1&waypoints=${park.lat},${park.lng}&destination=${address.lat},${address.lng}&travelmode=driving`;
  }
  if (isPoint(stop.lat, stop.lng)) return googleMapsNavigationUrl(stop.lat!, stop.lng!);
  return null;
}

/** Apple Maps supports one destination: the Parkplatz when there is one (D30), else the point. */
export function stopAppleNavigationUrl(stop: NavigationStop): string | null {
  if (!isPoint(stop.lat, stop.lng)) return null;
  return appleMapsNavigationUrl(stop.lat!, stop.lng!);
}
