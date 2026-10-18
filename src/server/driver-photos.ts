import { z } from "zod";

import {
  DRIVER_PHOTO_KINDS,
  isPhotoTourDayAllowed,
  PHOTO_REGISTER_MAX_BODY_BYTES,
  PHOTO_TOUR_STATUSES,
  type PhotoRegisterError,
  type PhotoRegisterResponse,
} from "@/domain/driver-photo";
import type { PrismaClient } from "@/generated/prisma/client";
import { dayInTimezone } from "@/lib/driver-tour-model";
import { isCustomerPhotoKey } from "@/lib/uploads";

import { type Actor, authErrorStatus, requireRole } from "./auth/guards";
import { rejectCrossOrigin } from "./csrf";
import { attachCustomerPhoto } from "./customer-photos";
import { getDb } from "./db";
import { DRIVER_PHOTO_URL_TTL_SECONDS } from "./driver-tour-payload";
import { readTextLimited } from "./http-body";
import { getFactoryTimezone } from "./settings";
import { getStorage } from "./storage";
import type { Storage } from "./storage/types";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

/**
 * Strict like the status mutations of NUD-053: unknown fields are rejected. The customer is never
 * a parameter: it is derived from the stop, and the stop has to be one of the driver's own.
 */
export const registerDriverPhotoSchema = z.strictObject({
  clientMutationId: z.uuid(),
  stopId: z.string().min(1).max(64),
  kind: z.enum(DRIVER_PHOTO_KINDS),
  /** Must be exactly what `POST /api/uploads` issues (`customers/<uuid>.<ext>`). */
  storageKey: z.string().max(200).refine(isCustomerPhotoKey),
  width: z.number().int().min(1).max(20_000),
  height: z.number().int().min(1).max(20_000),
});
export type RegisterDriverPhotoInput = z.input<typeof registerDriverPhotoSchema>;

type PhotoDb = Pick<PrismaClient, "$transaction" | "customer" | "photo" | "stop" | "auditLog">;
type ActingDriver = Pick<Actor, "id" | "role">;

export type RegisterDriverPhotoDeps = {
  storage: Pick<Storage, "head" | "getReadUrl">;
  /** IANA time zone of the factory (decides "today"). */
  timezone: string;
};

/**
 * Registers a photo the driver took at a stop as the customer's current photo of that kind
 * (NUD-083). The image is already in storage (presigned PUT, NUD-006); this call only attaches it.
 *
 * - DRIVER only (`actor.role`), the caller has run `requireRole`.
 * - The stop must belong to a tour assigned to the acting driver that was released (RELEASED,
 *   IN_PROGRESS or COMPLETED) and whose day is today or yesterday in the factory time zone
 *   (offline queue); otherwise `not_found` (same answer for foreign and unknown stops) or
 *   `tour_not_active`. The customer is the stop's customer.
 * - Idempotent by `clientMutationId` (`Photo.clientMutationId` is unique): a retry returns the
 *   photo of the first call with `replayed`; under the customer row lock, so concurrent retries
 *   cannot create two photos.
 * - Everything else (storage key shape, object exists, one current photo per kind, history) is the
 *   shared `attachCustomerPhoto` of the office flow.
 */
export async function registerDriverPhoto(
  db: PhotoDb,
  actor: ActingDriver,
  raw: unknown,
  deps: RegisterDriverPhotoDeps,
  now: Date = new Date(),
): Promise<PhotoRegisterResponse> {
  const reject = (error: PhotoRegisterError): PhotoRegisterResponse => ({
    outcome: "rejected",
    error,
  });
  if (actor.role !== "DRIVER") return reject("not_found");
  const parsed = registerDriverPhotoSchema.safeParse(raw);
  if (!parsed.success) return reject("invalid");
  const input = parsed.data;

  const stop = await db.stop.findFirst({
    where: { id: input.stopId, tour: { driverId: actor.id } },
    select: { customerId: true, tourId: true, tour: { select: { status: true, date: true } } },
  });
  if (!stop) return reject("not_found");

  const earlier = await db.photo.findUnique({
    where: { clientMutationId: input.clientMutationId },
    select: { uploadedById: true },
  });
  // A retry is answered even when the tour has been closed in the meantime: it was accepted once.
  if (!earlier) {
    const tourDay = stop.tour.date.toISOString().slice(0, 10);
    if (
      !(PHOTO_TOUR_STATUSES as readonly string[]).includes(stop.tour.status) ||
      !isPhotoTourDayAllowed(tourDay, dayInTimezone(now, deps.timezone))
    ) {
      return reject("tour_not_active");
    }
  }

  const result = await attachCustomerPhoto(db, deps.storage, {
    customerId: stop.customerId,
    kind: input.kind,
    storageKey: input.storageKey,
    width: input.width,
    height: input.height,
    uploadedById: actor.id,
    clientMutationId: input.clientMutationId,
    driverStop: { stopId: input.stopId, tourId: stop.tourId },
  });
  if (!result.ok) return reject(result.error);

  const photo = await db.photo.findUniqueOrThrow({ where: { id: result.photoId } });
  return {
    outcome: result.replayed ? "replayed" : "applied",
    kind: photo.kind,
    customerId: photo.customerId,
    photo: {
      id: photo.id,
      url: await deps.storage.getReadUrl(photo.storageKey, {
        expiresInSeconds: DRIVER_PHOTO_URL_TTL_SECONDS,
      }),
      width: photo.width,
      height: photo.height,
    },
  };
}

/**
 * `POST /api/driver/photos` (NUD-083). DRIVER only: `requireRole("DRIVER")` comes first (anonymous
 * -> 401, other roles -> 403); the driver is the session user. Body: JSON `RegisterDriverPhotoInput`
 * (zod, strict, <= 8 KiB). Answer: `PhotoRegisterResponse` (HTTP 200 also for a business
 * rejection, like the status sync), never cached. JSON-only content type + cookie authentication:
 * no cross-site form posts.
 */
export async function driverPhotoResponse(request: Request, now: Date = new Date()) {
  let actor;
  try {
    actor = await requireRole("DRIVER");
  } catch (error) {
    const status = authErrorStatus(error);
    if (!status) throw error;
    return Response.json(
      { error: status === 401 ? "unauthenticated" : "forbidden" },
      { status, headers: NO_STORE },
    );
  }
  const bad = (status: number, error: string) =>
    Response.json({ error }, { status, headers: NO_STORE });

  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;

  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return bad(415, "unsupported_media_type");
  }
  const text = await readTextLimited(request, PHOTO_REGISTER_MAX_BODY_BYTES);
  if (text === null) return bad(413, "too_large");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return bad(400, "invalid");
  }
  if (!registerDriverPhotoSchema.safeParse(json).success) return bad(400, "invalid");

  const body = await registerDriverPhoto(
    getDb(),
    actor,
    json,
    { storage: getStorage(), timezone: await getFactoryTimezone() },
    now,
  );
  return Response.json(body, { headers: NO_STORE });
}
