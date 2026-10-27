import { z } from "zod";

import { activeParkingSpots, routingPoint } from "@/domain/parking";
import type { PhotoKind } from "@/domain/photos";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  dayInTimezone,
  DRIVER_TOUR_SCHEMA_VERSION,
  type DriverTourResponse,
  type PayloadPhoto,
  type PayloadStop,
} from "@/lib/driver-tour-model";
import { localizedTextSchema } from "@/lib/localized-text";

import type { Actor } from "./auth/guards";
import { parkingSpotsForDriver } from "./routing-points";
import type { Storage } from "./storage/types";
import { getDriverTour } from "./tour-driver";

/**
 * Validity of the signed photo URLs in the tour payload. The driver app downloads the photos right
 * after loading the tour, but the URLs must stay usable for a whole working day (NUD-081: >= 12 h),
 * e.g. when a prefetch is retried after a dead spot.
 */
export const DRIVER_PHOTO_URL_TTL_SECONDS = 12 * 60 * 60;

type Db = Pick<PrismaClient, "tour" | "product" | "customer" | "photo">;

const depotSchema = z.object({ name: z.string(), lat: z.number(), lng: z.number() });
const geometrySchema = z.object({ coordinates: z.array(z.tuple([z.number(), z.number()])) });

export type DriverTourPayloadOptions = {
  now: Date;
  timezone: string;
  serviceMinutesPerStop: number;
  /**
   * Signed photo URLs are only generated when a storage is given. `onlyStopId` limits them to the
   * customer of that stop (the stop detail page needs no photos of the other stops).
   */
  photos?: { storage: Pick<Storage, "getReadUrl">; onlyStopId?: string };
};

/**
 * The tour `actor` drives today (released, assigned to him, date = today in the factory time zone)
 * as the shared driver data model. The driver id always comes from the authenticated actor, never
 * from a request parameter; only an actual DRIVER has a tour (an admin in the support view gets
 * `tour: null`). Quantities are the released snapshot (`getDriverTour`, NUD-043).
 */
export async function getDriverTourResponse(
  db: Db,
  actor: Pick<Actor, "id" | "role">,
  options: DriverTourPayloadOptions,
): Promise<DriverTourResponse> {
  const date = dayInTimezone(options.now, options.timezone);
  const base = {
    schemaVersion: DRIVER_TOUR_SCHEMA_VERSION,
    date,
    generatedAt: options.now.toISOString(),
    timezone: options.timezone,
    serviceSecondsPerStop: options.serviceMinutesPerStop * 60,
  } as const;
  if (actor.role !== "DRIVER") return { ...base, tour: null };
  const tour = await getDriverTour(db, actor.id, date);
  if (!tour) return { ...base, tour: null };

  const customerIds = [...new Set(tour.stops.map((s) => s.customerId))];
  const photoCustomerIds = options.photos
    ? options.photos.onlyStopId
      ? customerIds.filter(
          (id) => tour.stops.find((s) => s.id === options.photos?.onlyStopId)?.customerId === id,
        )
      : customerIds
    : [];

  const [customers, row, photoRows] = await Promise.all([
    db.customer.findMany({
      where: { id: { in: customerIds } },
      select: {
        id: true,
        customerNumber: true,
        name: true,
        street: true,
        postalCode: true,
        city: true,
        lat: true,
        lng: true,
        parkingSpots: parkingSpotsForDriver,
        notes: true,
        deliveryHoursInfo: true,
        hasKey: true,
        keyNumber: true,
      },
    }),
    db.tour.findUnique({ where: { id: tour.id }, select: { depotSnapshot: true, geometry: true } }),
    photoCustomerIds.length > 0
      ? db.photo.findMany({
          where: { customerId: { in: photoCustomerIds }, isCurrent: true },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        })
      : Promise.resolve([]),
  ]);
  const byId = new Map(customers.map((c) => [c.id, c]));
  const depot = depotSchema.safeParse(row?.depotSnapshot);
  const geometry = geometrySchema.safeParse(row?.geometry);

  // Newest current photo per customer and kind.
  const photoByCustomer = new Map<string, Partial<Record<PhotoKind, PayloadPhoto>>>();
  for (const photo of photoRows) {
    const entry = photoByCustomer.get(photo.customerId) ?? {};
    if (!entry[photo.kind as PhotoKind] && options.photos) {
      entry[photo.kind as PhotoKind] = {
        id: photo.id,
        url: await options.photos.storage.getReadUrl(photo.storageKey, {
          expiresInSeconds: DRIVER_PHOTO_URL_TTL_SECONDS,
        }),
        width: photo.width,
        height: photo.height,
      };
    }
    photoByCustomer.set(photo.customerId, entry);
  }

  const stops: PayloadStop[] = tour.stops.map((stop) => {
    const customer = byId.get(stop.customerId);
    const point = customer ? routingPoint(customer) : null;
    const notes = localizedTextSchema.safeParse(customer?.notes);
    const photos = photoByCustomer.get(stop.customerId);
    return {
      id: stop.id,
      sequence: stop.sequence,
      status: stop.status,
      problemReason: stop.problemReason,
      completedAt: stop.completedAt,
      etaAt: stop.etaAt,
      legDurationS: stop.legDurationS,
      change: stop.change,
      changedInRevision: stop.changedInRevision,
      customerId: stop.customerId,
      customerNumber: customer?.customerNumber ?? "",
      customerName: customer?.name ?? "",
      street: customer?.street ?? "",
      postalCode: customer?.postalCode ?? "",
      city: customer?.city ?? "",
      // Navigation and the map use the same point as the optimisation: Parkplatz, else address.
      lat: point?.lat ?? null,
      lng: point?.lng ?? null,
      addressLat: customer?.lat ?? null,
      addressLng: customer?.lng ?? null,
      parkingSpots: activeParkingSpots(customer?.parkingSpots ?? []).map((spot) => ({
        label: spot.label,
        note: spot.note,
        lat: spot.lat,
        lng: spot.lng,
      })),
      notes: notes.success ? notes.data : null,
      deliveryHoursInfo: customer?.deliveryHoursInfo?.trim() || null,
      hasKey: customer?.hasKey ?? null,
      keyNumber: customer?.keyNumber ?? null,
      photos: { STORE: photos?.STORE ?? null, PARKING: photos?.PARKING ?? null },
      items: stop.items.map((item) => {
        const name = localizedTextSchema.safeParse(item.name);
        return {
          productId: item.productId,
          sku: item.sku,
          name: name.success ? name.data : null,
          unit: item.unit,
          quantity: item.quantity,
          previousQuantity: item.previousQuantity,
        };
      }),
    };
  });

  return {
    ...base,
    tour: {
      id: tour.id,
      status: tour.status,
      revision: tour.revision,
      updated: tour.updated,
      removedCustomers: tour.removedCustomers,
      stops,
      depot: depot.success ? depot.data : null,
      geometry:
        geometry.success && geometry.data.coordinates.length > 1 ? geometry.data.coordinates : null,
    },
  };
}
