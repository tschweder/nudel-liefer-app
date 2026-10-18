import type { DriverPhotoKind, RegisteredPhoto } from "@/domain/driver-photo";

/**
 * Pure logic of the photos a driver takes at a stop (NUD-083): what a queued photo is, which
 * queued photo replaces which, what the stop screen shows while a photo waits, and how a registered
 * photo is written into the stored tour copy. No browser, no React, no zod: used by the page, the
 * service worker (Background Sync) and the unit tests.
 */

/** One photo waiting on the device until it is uploaded and registered. */
export type PhotoEntry = {
  /** Idempotency key of the capture; also the key in IndexedDB. */
  clientMutationId: string;
  /** The driver the photo belongs to; entries are only ever sent in that driver's session. */
  userId: string;
  stopId: string;
  customerId: string;
  /** For notices (customer names are never translated). */
  customerName: string;
  kind: DriverPhotoKind;
  /** The resized JPEG (longest edge <= 1600 px), stored in IndexedDB. */
  blob: Blob;
  width: number;
  height: number;
  /** ISO time the photo was taken. */
  createdAt: string;
  /** Monotonic order within the queue. */
  seq: number;
  /**
   * Set once the blob has been PUT to storage: the next attempt only registers it, a retry never
   * uploads twice. Cleared when the server reports the object missing.
   */
  storageKey?: string;
  /** How often the server did not find the object after we uploaded it. */
  missingCount?: number;
};

export const MAX_MISSING_RETRIES = 3;

export function sortPhotoEntries<T extends Pick<PhotoEntry, "createdAt" | "seq">>(
  entries: readonly T[],
): T[] {
  return [...entries].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.seq - b.seq,
  );
}

/**
 * Queued photos that a new photo of the same customer and kind makes pointless (they would be
 * current for a moment and then replaced): not sent yet and not on their way. A photo whose request
 * is in flight stays; it is then replaced by the newer one on the server, as intended.
 */
export function supersededBy(
  queued: readonly PhotoEntry[],
  incoming: Pick<PhotoEntry, "customerId" | "kind" | "userId">,
  inFlight: ReadonlySet<string>,
): string[] {
  return queued
    .filter(
      (e) =>
        e.userId === incoming.userId &&
        e.customerId === incoming.customerId &&
        e.kind === incoming.kind &&
        !e.storageKey &&
        !inFlight.has(e.clientMutationId),
    )
    .map((e) => e.clientMutationId);
}

/** The photo that counts on screen for a slot: the newest queued one. */
export function newestQueued(
  entries: readonly PhotoEntry[],
  customerId: string,
  kind: DriverPhotoKind,
): PhotoEntry | null {
  return (
    sortPhotoEntries(entries.filter((e) => e.customerId === customerId && e.kind === kind)).at(
      -1,
    ) ?? null
  );
}

/** A photo as the stop screen shows it. */
export type ShownPhoto = {
  id: string;
  url: string;
  width: number;
  height: number;
  /** Waiting on the device to be sent. */
  pending: boolean;
  /** The server has just taken it (shown for a short while on top of not yet refreshed data). */
  sent: boolean;
};

type PhotoLike = { id: string; url: string; width: number; height: number };

/** A photo the server took, remembered for a moment (see `CONFIRMED_PHOTO_TTL_MS`). */
export type ConfirmedPhoto = RegisteredPhoto & { customerId: string; kind: DriverPhotoKind };

export const confirmedKey = (customerId: string, kind: DriverPhotoKind) => `${customerId}:${kind}`;

/**
 * What a slot shows: the newest queued photo (from the local blob, `urlFor`) wins over a photo the
 * server just confirmed, which wins over the photo the page was rendered with.
 */
export function shownPhoto(
  base: PhotoLike | null,
  entry: PhotoEntry | null,
  confirmed: ConfirmedPhoto | undefined,
  urlFor: (entry: PhotoEntry) => string | undefined,
): ShownPhoto | null {
  if (entry) {
    const url = urlFor(entry);
    if (url) {
      return {
        id: `pending-${entry.clientMutationId}`,
        url,
        width: entry.width,
        height: entry.height,
        pending: true,
        sent: false,
      };
    }
  }
  if (confirmed) {
    return {
      id: confirmed.id,
      url: confirmed.url,
      width: confirmed.width,
      height: confirmed.height,
      pending: false,
      sent: true,
    };
  }
  return base ? { ...base, pending: false, sent: false } : null;
}

type PatchableTour = {
  tour: null | {
    stops: Array<{
      customerId: string;
      photos: Record<DriverPhotoKind, PhotoLike | null>;
    }>;
  };
};

/**
 * The stored tour copy with a registered photo as the current one of every stop of its customer
 * (so a reload while offline shows it). The tour JSON is refreshed from the server right after
 * anyway.
 */
export function patchTourPhoto<T extends PatchableTour>(
  data: T,
  customerId: string,
  kind: DriverPhotoKind,
  photo: RegisteredPhoto,
): T {
  const tour = data.tour;
  if (!tour || !tour.stops.some((s) => s.customerId === customerId)) return data;
  return {
    ...data,
    tour: {
      ...tour,
      stops: tour.stops.map((stop) =>
        stop.customerId === customerId
          ? {
              ...stop,
              photos: {
                ...stop.photos,
                [kind]: { id: photo.id, url: photo.url, width: photo.width, height: photo.height },
              },
            }
          : stop,
      ),
    },
  };
}

/** How long a just-confirmed photo is shown on top of the page data. */
export const CONFIRMED_PHOTO_TTL_MS = 20_000;
