import { z } from "zod";

import { resolvePinConfirmed, suggestNextCustomerNumber } from "@/domain/customer";
import { calendarDayIn } from "@/domain/settings";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { roundCoord } from "@/lib/coords";
import { createLocalizedText, type LocalizedText, localizedTextSchema } from "@/lib/localized-text";

import { MAX_ADDRESS_LENGTH } from "./geocoder";

type CustomerDb = Pick<PrismaClient, "customer" | "order" | "photo">;

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .default(null);

/**
 * Customer form input (create and update). `lat`/`lng` come as a pair or both `null`;
 * `pinConfirmed` is the admin's explicit confirmation and is further limited by the pin rules
 * in `src/domain/customer.ts`.
 */
export const customerInputSchema = z
  .object({
    customerNumber: text(32),
    name: text(160),
    street: text(160),
    postalCode: text(16),
    city: text(100),
    country: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{2}$/)
      .transform((v) => v.toUpperCase())
      .default("AT"),
    lat: z.number().min(-90).max(90).transform(roundCoord).nullable().default(null),
    lng: z.number().min(-180).max(180).transform(roundCoord).nullable().default(null),
    pinConfirmed: z.boolean().default(false),
    deliveryHoursInfo: optionalText(300),
    /** German note for the driver; the multilingual editor is NUD-071. */
    notes: optionalText(2000),
  })
  .refine((v) => (v.lat === null) === (v.lng === null), { message: "pin" })
  .refine((v) => `${v.street}, ${v.postalCode} ${v.city}`.length <= MAX_ADDRESS_LENGTH, {
    message: "address",
  });

export type CustomerInput = z.input<typeof customerInputSchema>;
export type CustomerSaveResult =
  | { ok: true; id: string; pinConfirmed: boolean }
  | { ok: false; error: "invalid" | "number_taken" | "not_found" };

const idSchema = z.string().trim().min(1).max(64);

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002"
  );
}

/** Notes shown in the (German) textarea. */
export function notesText(notes: unknown): string {
  const parsed = localizedTextSchema.safeParse(notes);
  return parsed.success ? (parsed.data.de ?? "") : "";
}

/** A changed German note replaces the stored LocalizedText (translations of old text are stale). */
function nextNotes(stored: unknown, input: string | null): LocalizedText | null {
  if (input === null) return null;
  if (notesText(stored) === input && localizedTextSchema.safeParse(stored).success) {
    return stored as LocalizedText;
  }
  return createLocalizedText({ de: input }, "de");
}

/** Prisma needs `DbNull` (not `null`) to store SQL NULL in a Json column. */
function notesData(notes: LocalizedText | null): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return notes === null ? Prisma.DbNull : (notes as unknown as Prisma.InputJsonValue);
}

async function numberTaken(db: CustomerDb, number: string, exceptId?: string): Promise<boolean> {
  const hit = await db.customer.findFirst({
    where: {
      customerNumber: { equals: number, mode: "insensitive" },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });
  return hit !== null;
}

/** Creates a customer. The caller checked the role. */
export async function createCustomer(
  db: CustomerDb,
  rawInput: unknown,
): Promise<CustomerSaveResult> {
  const parsed = customerInputSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;
  if (await numberTaken(db, v.customerNumber)) return { ok: false, error: "number_taken" };
  const pin = v.lat !== null && v.lng !== null ? { lat: v.lat, lng: v.lng } : null;
  const pinConfirmed = resolvePinConfirmed(v.pinConfirmed, null, { address: v, pin });
  try {
    const row = await db.customer.create({
      data: {
        customerNumber: v.customerNumber,
        name: v.name,
        street: v.street,
        postalCode: v.postalCode,
        city: v.city,
        country: v.country,
        lat: v.lat,
        lng: v.lng,
        pinConfirmed,
        deliveryHoursInfo: v.deliveryHoursInfo,
        notes: notesData(nextNotes(null, v.notes)),
      },
      select: { id: true },
    });
    return { ok: true, id: row.id, pinConfirmed };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: "number_taken" };
    throw error;
  }
}

/** Updates a customer; changing the address without moving the pin resets `pinConfirmed`. */
export async function updateCustomer(
  db: CustomerDb,
  rawId: unknown,
  rawInput: unknown,
): Promise<CustomerSaveResult> {
  const id = idSchema.safeParse(rawId);
  const parsed = customerInputSchema.safeParse(rawInput);
  if (!id.success || !parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;
  const stored = await db.customer.findUnique({ where: { id: id.data } });
  if (!stored) return { ok: false, error: "not_found" };
  if (await numberTaken(db, v.customerNumber, stored.id)) {
    return { ok: false, error: "number_taken" };
  }
  const storedPin =
    stored.lat !== null && stored.lng !== null ? { lat: stored.lat, lng: stored.lng } : null;
  const pin = v.lat !== null && v.lng !== null ? { lat: v.lat, lng: v.lng } : null;
  const pinConfirmed = resolvePinConfirmed(
    v.pinConfirmed,
    { address: stored, pin: storedPin },
    { address: v, pin },
  );
  try {
    await db.customer.update({
      where: { id: stored.id },
      data: {
        customerNumber: v.customerNumber,
        name: v.name,
        street: v.street,
        postalCode: v.postalCode,
        city: v.city,
        country: v.country,
        lat: v.lat,
        lng: v.lng,
        pinConfirmed,
        deliveryHoursInfo: v.deliveryHoursInfo,
        notes: notesData(nextNotes(stored.notes, v.notes)),
      },
    });
    return { ok: true, id: stored.id, pinConfirmed };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: "number_taken" };
    throw error;
  }
}

/** Archive (`active = false`) or reactivate; customers are never deleted (backlog 4.3). */
export async function setCustomerActive(
  db: CustomerDb,
  rawId: unknown,
  rawActive: unknown,
): Promise<{ ok: true } | { ok: false; error: "invalid" | "not_found" }> {
  const id = idSchema.safeParse(rawId);
  const active = z.boolean().safeParse(rawActive);
  if (!id.success || !active.success) return { ok: false, error: "invalid" };
  const result = await db.customer.updateMany({
    where: { id: id.data },
    data: { active: active.data },
  });
  return result.count === 0 ? { ok: false, error: "not_found" } : { ok: true };
}

/** Next free customer number to prefill the "new customer" form. */
export async function nextCustomerNumber(db: CustomerDb): Promise<string> {
  const rows = await db.customer.findMany({ select: { customerNumber: true } });
  return suggestNextCustomerNumber(rows.map((r) => r.customerNumber));
}

export type CustomerDetail = {
  id: string;
  customerNumber: string;
  name: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
  lat: number | null;
  lng: number | null;
  pinConfirmed: boolean;
  deliveryHoursInfo: string | null;
  notes: string;
  active: boolean;
  hasStorePhoto: boolean;
  hasParkingPhoto: boolean;
};

export async function getCustomerDetail(
  db: CustomerDb,
  rawId: unknown,
): Promise<CustomerDetail | null> {
  const id = idSchema.safeParse(rawId);
  if (!id.success) return null;
  const row = await db.customer.findUnique({
    where: { id: id.data },
    include: {
      photos: { where: { isCurrent: true }, select: { kind: true } },
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    customerNumber: row.customerNumber,
    name: row.name,
    street: row.street,
    postalCode: row.postalCode,
    city: row.city,
    country: row.country,
    lat: row.lat,
    lng: row.lng,
    pinConfirmed: row.pinConfirmed,
    deliveryHoursInfo: row.deliveryHoursInfo,
    notes: notesText(row.notes),
    active: row.active,
    hasStorePhoto: row.photos.some((p) => p.kind === "STORE"),
    hasParkingPhoto: row.photos.some((p) => p.kind === "PARKING"),
  };
}

export type UpcomingOrder = {
  id: string;
  /** `DATE` value as UTC midnight. */
  deliveryDate: Date;
  status: "DRAFT" | "CONFIRMED" | "CANCELLED";
  items: Array<{ id: string; productName: unknown; unit: string; quantity: string }>;
};

/**
 * Orders of this customer with a delivery date from "today" (factory time zone) on, cancelled
 * ones excluded. Real data: the list is empty until orders exist (NUD-030).
 */
export async function listUpcomingOrders(
  db: CustomerDb,
  rawId: unknown,
  timezone: string,
  now: Date = new Date(),
  limit = 20,
): Promise<UpcomingOrder[]> {
  const id = idSchema.safeParse(rawId);
  if (!id.success) return [];
  const { y, m, d } = calendarDayIn(now, timezone);
  const rows = await db.order.findMany({
    where: {
      customerId: id.data,
      status: { not: "CANCELLED" },
      deliveryDate: { gte: new Date(Date.UTC(y, m - 1, d)) },
    },
    orderBy: [{ deliveryDate: "asc" }, { createdAt: "asc" }],
    take: limit,
    include: {
      items: {
        include: { product: { select: { name: true, unit: true } } },
        orderBy: { id: "asc" },
      },
    },
  });
  return rows.map((o) => ({
    id: o.id,
    deliveryDate: o.deliveryDate,
    status: o.status,
    items: o.items.map((i) => ({
      id: i.id,
      productName: i.product.name,
      unit: i.product.unit,
      quantity: i.quantity.toString(),
    })),
  }));
}
