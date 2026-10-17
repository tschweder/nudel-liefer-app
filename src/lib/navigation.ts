/**
 * Deep link that starts navigation in Google Maps (opens the app when installed, works on Android
 * and iOS). Always built from the confirmed pin, never from the address string (D16).
 */
export function googleMapsNavigationUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
}

/** Apple Maps directions to the confirmed pin (offered additionally on iOS). */
export function appleMapsNavigationUrl(lat: number, lng: number): string {
  return `https://maps.apple.com/?daddr=${lat},${lng}`;
}
