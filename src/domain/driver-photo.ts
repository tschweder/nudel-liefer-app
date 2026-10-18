/**
 * Contract and pure rules of the photo a driver takes at a stop (NUD-083). Shared by the server
 * (`POST /api/driver/photos`), the page and the service worker, so it imports nothing (no zod, no
 * framework): the request is validated with zod on the server (`server/driver-photos.ts`), the
 * response by the hand-written guard below.
 */

export const DRIVER_PHOTO_KINDS = ["STORE", "PARKING"] as const;
export type DriverPhotoKind = (typeof DRIVER_PHOTO_KINDS)[number];

/** The request is a few hundred bytes (the image itself goes straight to storage). */
export const PHOTO_REGISTER_MAX_BODY_BYTES = 8 * 1024;

/**
 * Tours a driver may add photos to: his own, released at some point. COMPLETED is included on
 * purpose: a driver often notices the missing parking photo while closing the last stop.
 */
export const PHOTO_TOUR_STATUSES = ["RELEASED", "IN_PROGRESS", "COMPLETED"] as const;

/** `YYYY-MM-DD` minus one calendar day. */
export function previousDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/**
 * A photo may be registered for a tour of `today` (factory time zone) or of the day before: a
 * photo taken offline in the evening is registered after midnight, and the driver's work must not
 * be thrown away for that. Older tours are closed for photos.
 */
export function isPhotoTourDayAllowed(tourDay: string, today: string): boolean {
  return tourDay === today || tourDay === previousDay(today);
}

export type PhotoRegisterRequest = {
  /** Idempotency key of this capture: a retry never creates a second photo. */
  clientMutationId: string;
  stopId: string;
  kind: DriverPhotoKind;
  /** Key of the object the client already PUT to storage (issued by `POST /api/uploads`). */
  storageKey: string;
  width: number;
  height: number;
};

/**
 * Why the server did not take a photo. All are final (the photo is dropped and the driver gets a
 * notice) except `object_missing`: the object is not in storage (yet), the client uploads again.
 */
export type PhotoRegisterError =
  | "invalid"
  | "not_found"
  | "tour_not_active"
  | "object_missing"
  | "key_in_use"
  | "mutation_conflict";

export const FINAL_PHOTO_ERRORS: readonly PhotoRegisterError[] = [
  "invalid",
  "not_found",
  "tour_not_active",
  "key_in_use",
  "mutation_conflict",
];

export type RegisteredPhoto = {
  id: string;
  /** Signed read URL, valid as long as those of the tour payload (12 h). */
  url: string;
  width: number;
  height: number;
};

export type PhotoRegisterResponse =
  | {
      outcome: "applied" | "replayed";
      kind: DriverPhotoKind;
      customerId: string;
      photo: RegisteredPhoto;
    }
  | { outcome: "rejected"; error: PhotoRegisterError };

const ERRORS: readonly string[] = [
  "invalid",
  "not_found",
  "tour_not_active",
  "object_missing",
  "key_in_use",
  "mutation_conflict",
];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** Structural check of the answer (the page and the worker trust nothing the network returns). */
export function parsePhotoRegisterResponse(raw: unknown): PhotoRegisterResponse | null {
  if (!isRecord(raw)) return null;
  if (raw.outcome === "rejected") {
    return typeof raw.error === "string" && ERRORS.includes(raw.error)
      ? { outcome: "rejected", error: raw.error as PhotoRegisterError }
      : null;
  }
  if (raw.outcome !== "applied" && raw.outcome !== "replayed") return null;
  const photo = raw.photo;
  if (
    !isRecord(photo) ||
    typeof photo.id !== "string" ||
    typeof photo.url !== "string" ||
    typeof photo.width !== "number" ||
    typeof photo.height !== "number" ||
    typeof raw.customerId !== "string" ||
    !(DRIVER_PHOTO_KINDS as readonly unknown[]).includes(raw.kind)
  ) {
    return null;
  }
  return {
    outcome: raw.outcome,
    kind: raw.kind as DriverPhotoKind,
    customerId: raw.customerId,
    photo: { id: photo.id, url: photo.url, width: photo.width, height: photo.height },
  };
}
