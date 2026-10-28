import { createHash } from "node:crypto";

import { haversineM } from "@/domain/routing";
import type { PrismaClient } from "@/generated/prisma/client";

import { attachCustomerPhoto } from "./customer-photos";
import { createParkingSpot } from "./parking-spots";
import type { Storage } from "./storage/types";

/**
 * The engine behind `scripts/parking-import/import-parking.ts`: it writes the reviewed
 * `2026-10` parking pins into the database.
 *
 * It lives in `src/server` rather than inside the CLI so the rules can be tested against a real
 * database with the Fake storage (`parking-import.integration.test.ts`); the CLI then only reads
 * the reviewed JSON, picks the actor and prints the table.
 *
 * Rules (docs/parking-import/PLAN-AND-ORCHESTRATOR-PROMPT.md, Phase 4):
 * - **Dry run by default.** Nothing is written and nothing is uploaded unless `apply` is true.
 * - One `ParkingSpot` per customer at the reviewed coordinates, through `createParkingSpot`, so
 *   the audit entry (`parking.create`, `via: office`) and the `PARKING_MAX_ACTIVE` limit are the
 *   same as for the office form.
 * - An active spot already within `SPOT_MATCH_M` of the pin is left alone (`spot_exists`); that
 *   covers a re-run of this import and the spots the office entered by hand.
 * - The parking photo goes through `attachCustomerPhoto` (`kind: PARKING`, audited as `photo.add`).
 *   A customer who already has a *different* current PARKING photo keeps it (`photo_exists`): the
 *   import never replaces a photo it did not store itself.
 * - Idempotent: `storageKeyFor` derives the object key from pin and customer, so a retry overwrites
 *   the same object instead of orphaning a new one, and the ledger decides whether the photo still
 *   has to be attached.
 * - No deletes, no soft-delete changes, nothing outside ParkingSpot/Photo/AuditLog.
 */

/** A spot this close to the pin is "the same spot" (the office's own work included). */
export const SPOT_MATCH_M = 5;

export type ImportEntry = {
  unitId: string;
  action: "create" | "exists" | "review";
  spot: { lat: number; lng: number } | null;
  customerIds: string[];
};

export type PreparedPhoto = {
  file: string;
  width: number;
  height: number;
  sha256: string;
};

export type LedgerEntry = {
  unitId: string;
  customerId: string;
  spotId: string | null;
  photoId: string | null;
  storageKey: string | null;
  sha256: string | null;
  appliedAt: string;
};

export type ImportOutcome =
  | "spot_created"
  | "spot_exists"
  | "spot_limit"
  | "spot_failed"
  | "photo_added"
  | "photo_already_ours"
  | "photo_exists"
  | "photo_failed"
  | "customer_missing";

export type ImportRow = {
  unitId: string;
  customerId: string;
  customerNumber: string | null;
  customerName: string | null;
  spotId: string | null;
  photoId: string | null;
  storageKey: string | null;
  spot: { lat: number; lng: number };
  spotOutcome: ImportOutcome;
  photoOutcome: ImportOutcome | null;
  notes: string[];
};

export type ImportSummary = {
  apply: boolean;
  rows: ImportRow[];
  spotsCreated: number;
  spotsExisting: number;
  photosAdded: number;
  photosKept: number;
  failures: number;
  entriesSkipped: number;
  ledger: LedgerEntry[];
};

type ImportDb = Pick<
  PrismaClient,
  "$transaction" | "customer" | "parkingSpot" | "photo" | "auditLog"
>;

export type UploadPhoto = (input: {
  unitId: string;
  customerId: string;
  /** The deterministic key the engine already decided on. */
  key: string;
  bytes: Buffer;
  contentType: string;
}) => Promise<void>;

/**
 * Deterministic object key per pin and customer: `customers/<uuid>.jpg`, the only shape
 * `attachCustomerPhoto` accepts (`isCustomerPhotoKey`). Deterministic so a retry after a partial
 * run reuses the same key instead of leaving an orphan object behind.
 */
export function storageKeyFor(unitId: string, customerId: string): string {
  const digest = createHash("sha1")
    .update(`nudel-parking-import:2026-10:${unitId}:${customerId}`)
    .digest("hex");
  const variant = ((parseInt(digest.slice(16, 18), 16) & 0x3f) | 0x80)
    .toString(16)
    .padStart(2, "0");
  const uuid = [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `5${digest.slice(13, 16)}`,
    `${variant}${digest.slice(18, 20)}`,
    digest.slice(20, 32),
  ].join("-");
  return `customers/${uuid}.jpg`;
}

export async function importParkingSpots(
  db: ImportDb,
  storage: Pick<Storage, "head">,
  options: {
    actorId: string;
    entries: ImportEntry[];
    /** unitId -> prepared photo (see `prepare-uploads.py`). */
    photos: Map<string, PreparedPhoto>;
    /** Reads the prepared bytes; only called when a photo is actually attached. */
    readPhoto?: (photo: PreparedPhoto) => Promise<Buffer>;
    /** Uploads the bytes and returns the key; only called when `apply` is true. */
    uploadPhoto?: UploadPhoto;
    /** What a previous run already did, so a second run does not do it twice. */
    ledger?: LedgerEntry[];
    label?: string | null;
    apply?: boolean;
    now?: Date;
  },
): Promise<ImportSummary> {
  const apply = options.apply ?? false;
  const now = options.now ?? new Date();
  const ledgerByKey = new Map(
    (options.ledger ?? []).map((entry) => [`${entry.unitId}:${entry.customerId}`, entry]),
  );
  const nextLedger: LedgerEntry[] = [...(options.ledger ?? [])];
  const rows: ImportRow[] = [];
  let entriesSkipped = 0;

  for (const entry of options.entries) {
    if (entry.action !== "create" || !entry.spot) {
      entriesSkipped += 1;
      continue;
    }
    // Narrowed once, so the closures below do not need a non-null assertion.
    const point = entry.spot;
    const photo = options.photos.get(entry.unitId) ?? null;

    for (const customerId of entry.customerIds) {
      const notes: string[] = [];
      const customer = await db.customer.findUnique({
        where: { id: customerId },
        select: {
          id: true,
          customerNumber: true,
          name: true,
          active: true,
          parkingSpots: {
            where: { active: true },
            select: { id: true, lat: true, lng: true },
          },
          photos: {
            where: { isCurrent: true, kind: "PARKING" },
            orderBy: { createdAt: "desc" },
            select: { id: true, storageKey: true },
          },
        },
      });
      if (!customer || !customer.active) {
        rows.push({
          unitId: entry.unitId,
          customerId,
          customerNumber: customer?.customerNumber ?? null,
          customerName: customer?.name ?? null,
          spotId: null,
          photoId: null,
          storageKey: null,
          spot: point,
          spotOutcome: "customer_missing",
          photoOutcome: null,
          notes: ["customer not found or inactive"],
        });
        continue;
      }

      // --- the spot ---------------------------------------------------------------------
      const nearby = customer.parkingSpots.find((spot) => haversineM(spot, point) <= SPOT_MATCH_M);
      let spotId: string | null = nearby?.id ?? null;
      let spotOutcome: ImportOutcome;
      if (nearby) {
        spotOutcome = "spot_exists";
        notes.push(
          `active Parkplatz ${nearby.id} is ${Math.round(haversineM(nearby, point))} m away`,
        );
      } else if (!apply) {
        spotOutcome = "spot_created";
        notes.push("dry run: would create the Parkplatz");
      } else {
        const created = await createParkingSpot(db, options.actorId, {
          customerId,
          label: options.label ?? null,
          note: null,
          lat: point.lat,
          lng: point.lng,
        });
        if (created.ok) {
          spotId = created.spotId ?? null;
          spotOutcome = "spot_created";
        } else {
          spotOutcome = created.error === "limit" ? "spot_limit" : "spot_failed";
          notes.push(`createParkingSpot: ${created.error}`);
        }
      }

      // --- the photo --------------------------------------------------------------------
      let photoId: string | null = null;
      let storageKey: string | null = null;
      let photoOutcome: ImportOutcome | null = null;
      const ledgerKey = `${entry.unitId}:${customerId}`;
      const previous = ledgerByKey.get(ledgerKey);
      const currentPhoto = customer.photos[0] ?? null;

      if (!photo) {
        photoOutcome = null;
      } else if (previous?.photoId && currentPhoto && previous.photoId === currentPhoto.id) {
        photoId = currentPhoto.id;
        storageKey = currentPhoto.storageKey;
        photoOutcome = "photo_already_ours";
      } else if (currentPhoto) {
        photoId = currentPhoto.id;
        storageKey = currentPhoto.storageKey;
        photoOutcome = "photo_exists";
        notes.push("kept the existing current PARKING photo");
      } else {
        storageKey = storageKeyFor(entry.unitId, customerId);
        photoOutcome = "photo_added";
        if (apply) {
          try {
            if (!options.uploadPhoto || !options.readPhoto) {
              throw new Error("uploadPhoto/readPhoto missing for an apply run");
            }
            const bytes = await options.readPhoto(photo);
            await options.uploadPhoto({
              unitId: entry.unitId,
              customerId,
              key: storageKey,
              bytes,
              contentType: "image/jpeg",
            });
            const attached = await attachCustomerPhoto(db, storage, {
              customerId,
              kind: "PARKING",
              storageKey,
              width: photo.width,
              height: photo.height,
              uploadedById: options.actorId,
            });
            if (attached.ok) {
              photoId = attached.photoId;
            } else {
              photoOutcome = "photo_failed";
              notes.push(`attachCustomerPhoto: ${attached.error}`);
            }
          } catch (error) {
            photoOutcome = "photo_failed";
            notes.push(`upload failed: ${error instanceof Error ? error.message : String(error)}`);
          }
        } else {
          notes.push(`dry run: would upload ${photo.file} as ${storageKey}`);
        }
      }

      if (apply && (spotId || photoId)) {
        const record: LedgerEntry = {
          unitId: entry.unitId,
          customerId,
          spotId,
          photoId,
          storageKey,
          sha256:
            photoOutcome === "photo_added" ? (photo?.sha256 ?? null) : (previous?.sha256 ?? null),
          appliedAt: now.toISOString(),
        };
        const index = nextLedger.findIndex(
          (item) => `${item.unitId}:${item.customerId}` === ledgerKey,
        );
        if (index >= 0) nextLedger[index] = record;
        else nextLedger.push(record);
      }

      rows.push({
        unitId: entry.unitId,
        customerId,
        customerNumber: customer.customerNumber,
        customerName: customer.name,
        spotId,
        photoId,
        storageKey,
        spot: point,
        spotOutcome,
        photoOutcome,
        notes,
      });
    }
  }

  return {
    apply,
    rows,
    spotsCreated: rows.filter((row) => row.spotOutcome === "spot_created").length,
    spotsExisting: rows.filter((row) => row.spotOutcome === "spot_exists").length,
    photosAdded: rows.filter((row) => row.photoOutcome === "photo_added").length,
    photosKept: rows.filter(
      (row) => row.photoOutcome === "photo_exists" || row.photoOutcome === "photo_already_ours",
    ).length,
    failures: rows.filter(
      (row) =>
        row.spotOutcome === "spot_failed" ||
        row.spotOutcome === "spot_limit" ||
        row.spotOutcome === "customer_missing" ||
        row.photoOutcome === "photo_failed",
    ).length,
    entriesSkipped,
    ledger: nextLedger,
  };
}
