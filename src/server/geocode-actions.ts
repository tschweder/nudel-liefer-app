"use server";

import { z } from "zod";

import { requireRole } from "./auth/guards";
import { type GeocodeCandidate, GeocoderError, getGeocoder, MAX_ADDRESS_LENGTH } from "./geocoder";

export type GeocodeActionResult =
  { ok: true; candidates: GeocodeCandidate[] } | { ok: false; error: "invalid" | "failed" };

const addressSchema = z.string().trim().min(1).max(MAX_ADDRESS_LENGTH);

/**
 * Admin-only: address -> candidate coordinates for the "locate address" button of the pin picker.
 * The role is checked before the input is read; the admin still confirms the pin (D9).
 */
export async function geocodeAddressAction(address: unknown): Promise<GeocodeActionResult> {
  await requireRole("ADMIN");
  const parsed = addressSchema.safeParse(address);
  if (!parsed.success) return { ok: false, error: "invalid" };
  try {
    return { ok: true, candidates: await getGeocoder().search(parsed.data) };
  } catch (error) {
    if (error instanceof GeocoderError) console.warn(`[geocoder] ${error.code}: ${error.message}`);
    else console.error(error);
    return { ok: false, error: "failed" };
  }
}
