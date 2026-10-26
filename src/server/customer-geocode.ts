import { addressQuery } from "@/domain/customer";
import { roundCoord } from "@/lib/coords";

import { type Geocoder, GeocoderError, MAX_ADDRESS_LENGTH } from "./geocoder";

/**
 * The best geocoder hit for an address, rounded, or `null` when nothing was found or the provider
 * failed (NUD-141: saving a customer never waits on, or fails because of, the geocoder; a customer
 * without any point is reported by the tour builder). Logs no addresses.
 */
export async function geocodeAddress(
  geocoder: Geocoder,
  address: { street: string; postalCode: string; city: string; country: string },
): Promise<{ lat: number; lng: number } | null> {
  try {
    const best = (await geocoder.search(addressQuery(address, MAX_ADDRESS_LENGTH)))[0];
    return best ? { lat: roundCoord(best.lat), lng: roundCoord(best.lng) } : null;
  } catch (error) {
    if (!(error instanceof GeocoderError)) throw error;
    console.warn(`[customer] geocoding failed: ${error.code} ${error.status ?? ""}`);
    return null;
  }
}
