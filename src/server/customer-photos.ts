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

/**
 * Stores a photo as the customer's current photo of `kind`. A previous current photo of the same
 * kind is kept with `isCurrent=false` (history, never hard-deleted); the swap is one transaction
 * under a row lock on the customer, so there is never more than one current photo per kind.
 */
export async function addCustomerPhoto(
  db: PhotoDb,
  storage: Pick<Storage, "head">,
  uploadedById: string,
  raw: unknown,
): Promise<AddCustomerPhotoResult> {
  const parsed = addCustomerPhotoSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const input = parsed.data;

  const stored = await storage.head(input.storageKey);
  if (!stored) return { ok: false, error: "object_missing" };
  if (stored.bytes <= 0 || stored.bytes > MAX_UPLOAD_BYTES) return { ok: false, error: "invalid" };

  return db.$transaction(async (tx): Promise<AddCustomerPhotoResult> => {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Customer" WHERE "id" = ${input.customerId} FOR UPDATE`;
    if (locked.length === 0) return { ok: false, error: "not_found" };
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
        uploadedById,
        isCurrent: true,
      },
    });
    return { ok: true, photoId: photo.id };
  });
}

export type CustomerPhotoView = {
  id: string;
  /** Signed, short-lived read URL generated on the server. */
  url: string;
  width: number;
  height: number;
  createdAt: Date;
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
    };
  }
  return result;
}
