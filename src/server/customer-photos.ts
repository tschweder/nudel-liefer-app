import { z } from "zod";

import { PHOTO_KINDS, type PhotoKind } from "@/domain/photos";
import type { PrismaClient } from "@/generated/prisma/client";
import { isCustomerPhotoKey, MAX_UPLOAD_BYTES } from "@/lib/uploads";

import type { Storage } from "./storage/types";

type PhotoDb = Pick<PrismaClient, "$transaction" | "customer" | "photo">;

const idSchema = z.string().trim().min(1).max(64);

/**
 * `storageKey` must be a key the upload endpoint issues (`customers/<uuid>.<ext>`, see
 * `isCustomerPhotoKey`). Width and height are measured by the browser after resizing and are
 * only used for layout; the size is read from the stored object, never from the client.
 */
export const addCustomerPhotoSchema = z.object({
  customerId: idSchema,
  kind: z.enum(PHOTO_KINDS),
  storageKey: z.string().max(200).refine(isCustomerPhotoKey),
  width: z.number().int().min(1).max(20_000),
  height: z.number().int().min(1).max(20_000),
});

export type AddCustomerPhotoResult =
  | { ok: true; photoId: string }
  | { ok: false; error: "invalid" | "not_found" | "object_missing" | "key_in_use" };

export type AttachPhotoInput = {
  customerId: string;
  kind: PhotoKind;
  storageKey: string;
  width: number;
  height: number;
  uploadedById: string;
  /**
   * Idempotency key (driver capture, NUD-083). A second call with the same key returns the photo
   * of the first call (`replayed`) instead of creating another one; a key that belongs to a photo
   * of another user is `mutation_conflict`.
   */
  clientMutationId?: string;
};

export type AttachPhotoResult =
  | { ok: true; photoId: string; replayed: boolean }
  | {
      ok: false;
      error: "invalid" | "not_found" | "object_missing" | "key_in_use" | "mutation_conflict";
    };

/**
 * The shared core of "this object is now the customer's current photo of `kind`" for the office
 * (`addCustomerPhoto`) and for drivers (`registerDriverPhoto`, NUD-083); the callers have done
 * authorization and input validation. A previous current photo of the same kind is kept with
 * `isCurrent=false` (history, never hard-deleted); the swap is one transaction under a row lock on
 * the customer, so there is never more than one current photo per kind. The object must exist in
 * storage (`head`), its size comes from there.
 */
export async function attachCustomerPhoto(
  db: PhotoDb,
  storage: Pick<Storage, "head">,
  input: AttachPhotoInput,
): Promise<AttachPhotoResult> {
  const stored = await storage.head(input.storageKey);
  if (!stored) return { ok: false, error: "object_missing" };
  if (stored.bytes <= 0 || stored.bytes > MAX_UPLOAD_BYTES) return { ok: false, error: "invalid" };

  return db.$transaction(async (tx): Promise<AttachPhotoResult> => {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Customer" WHERE "id" = ${input.customerId} FOR UPDATE`;
    if (locked.length === 0) return { ok: false, error: "not_found" };
    if (input.clientMutationId) {
      // Checked under the lock: two concurrent retries of one capture cannot both insert.
      const earlier = await tx.photo.findUnique({
        where: { clientMutationId: input.clientMutationId },
        select: { id: true, uploadedById: true },
      });
      if (earlier) {
        return earlier.uploadedById === input.uploadedById
          ? { ok: true, photoId: earlier.id, replayed: true }
          : { ok: false, error: "mutation_conflict" };
      }
    }
    if (
      await tx.photo.findFirst({ where: { storageKey: input.storageKey }, select: { id: true } })
    ) {
      return { ok: false, error: "key_in_use" };
    }
    await tx.photo.updateMany({
      where: { customerId: input.customerId, kind: input.kind, isCurrent: true },
      data: { isCurrent: false },
    });
    const photo = await tx.photo.create({
      data: {
        customerId: input.customerId,
        kind: input.kind,
        storageKey: input.storageKey,
        width: input.width,
        height: input.height,
        bytes: stored.bytes,
        uploadedById: input.uploadedById,
        isCurrent: true,
        clientMutationId: input.clientMutationId ?? null,
      },
    });
    return { ok: true, photoId: photo.id, replayed: false };
  });
}

/** Office: validates the input and stores the photo as the customer's current one. */
export async function addCustomerPhoto(
  db: PhotoDb,
  storage: Pick<Storage, "head">,
  uploadedById: string,
  raw: unknown,
): Promise<AddCustomerPhotoResult> {
  const parsed = addCustomerPhotoSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const result = await attachCustomerPhoto(db, storage, { ...parsed.data, uploadedById });
  // The office sends no idempotency key, so `mutation_conflict` cannot happen here.
  if (!result.ok) {
    return { ok: false, error: result.error === "mutation_conflict" ? "invalid" : result.error };
  }
  return { ok: true, photoId: result.photoId };
}

export type CustomerPhotoView = {
  id: string;
  /** Signed, short-lived read URL generated on the server. */
  url: string;
  width: number;
  height: number;
  createdAt: Date;
  /** Who added this photo (shown to the office as "updated by driver X"). */
  uploadedBy: { name: string; role: "ADMIN" | "DRIVER" };
};
export type CustomerPhotos = Record<PhotoKind, CustomerPhotoView | null>;

/** The current photo of each kind with a signed read URL (bucket stays private). */
export async function getCustomerPhotos(
  db: Pick<PrismaClient, "photo">,
  storage: Pick<Storage, "getReadUrl">,
  rawCustomerId: unknown,
): Promise<CustomerPhotos> {
  const result: CustomerPhotos = { STORE: null, PARKING: null };
  const id = idSchema.safeParse(rawCustomerId);
  if (!id.success) return result;
  const rows = await db.photo.findMany({
    where: { customerId: id.data, isCurrent: true },
    orderBy: { createdAt: "desc" },
    include: { uploadedBy: { select: { displayName: true, role: true } } },
  });
  for (const kind of PHOTO_KINDS) {
    const row = rows.find((r) => r.kind === kind);
    if (!row) continue;
    result[kind] = {
      id: row.id,
      url: await storage.getReadUrl(row.storageKey),
      width: row.width,
      height: row.height,
      createdAt: row.createdAt,
      uploadedBy: { name: row.uploadedBy.displayName, role: row.uploadedBy.role },
    };
  }
  return result;
}
