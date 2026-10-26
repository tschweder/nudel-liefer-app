import { createHash } from "node:crypto";

import { calendarDayIn, nextDeliveryDate } from "@/domain/settings";
import type { PrismaClient } from "@/generated/prisma/client";
import { createLocalizedText } from "@/lib/localized-text";

import { addCustomerPhoto } from "./customer-photos";
import {
  DEMO_CUSTOMERS,
  DEMO_DEPOT,
  DEMO_ORDER_NOTE,
  DEMO_PRODUCT_SKUS,
  demoOrderLines,
} from "./demo-data";
import { readS3Config, type Storage } from "./storage";
import { renderPlaceholderPng, type Rgb } from "./testing/placeholder-image";

export type DemoSeedSummary = {
  deliveryDate: string;
  depotUpdated: boolean;
  customersCreated: number;
  photosCreated: number;
  ordersCreated: number;
};

/** Writes one object through the presigned URL the Storage interface hands out. */
export type UploadObject = (
  storage: Pick<Storage, "createUploadUrl">,
  key: string,
  body: Buffer,
  contentType: string,
) => Promise<void>;

export const uploadWithPresignedUrl: UploadObject = async (storage, key, body, contentType) => {
  const target = await storage.createUploadUrl({ key, contentType, contentLength: body.length });
  const response = await fetch(target.url, {
    method: target.method,
    headers: target.headers,
    body: new Uint8Array(body),
  });
  if (!response.ok) {
    throw new Error(`Uploading ${key} failed: HTTP ${response.status} ${await response.text()}`);
  }
};

/**
 * The demo photos live in the object storage, so the Fake in-memory store (which forgets
 * everything when the process ends) cannot be used: the seed refuses to run without S3_*.
 */
export function assertDemoStorageConfigured(env: Record<string, string | undefined>) {
  if (readS3Config(env)) return;
  throw new Error(
    "pnpm db:seed --demo stores placeholder photos in the object storage and needs an " +
      "S3-compatible store (MinIO via `docker compose up`, or R2): set S3_BUCKET, S3_ACCESS_KEY_ID, " +
      "S3_SECRET_ACCESS_KEY (and S3_ENDPOINT for MinIO). The in-memory Fake storage would lose the photos. " +
      "Use --no-photos to seed the demo customers and orders without photos (CI).",
  );
}

/** Deterministic UUID (SHA-1 based, v5 layout) so reruns reuse the same storage keys. */
export function demoUuid(seed: string): string {
  const h = createHash("sha1").update(`nudel-demo:${seed}`).digest("hex");
  const variant = ((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

const PHOTO_STYLE = {
  STORE: { label: "EINGANG", background: [29, 78, 216] as Rgb },
  PARKING: { label: "PARKEN", background: [21, 128, 61] as Rgb },
} as const;

export function demoPhotoPng(kind: "STORE" | "PARKING", customerNumber: string): Buffer {
  const style = PHOTO_STYLE[kind];
  return renderPlaceholderPng({
    width: 800,
    height: 600,
    background: style.background,
    foreground: [255, 255, 255],
    lines: [
      { text: style.label, scale: 14 },
      { text: customerNumber, scale: 6 },
    ],
  });
}

type DemoDb = PrismaClient;

/**
 * Demo data for the client presentation (NUD-060). Idempotent: every row is looked up by a
 * natural key (customer number, SKU, photo kind, demo order marker) and left untouched when it
 * exists, so a rerun adds nothing. Needs the base seed (admin user) first.
 *
 * - Depot: replaced by a real Vienna address with a confirmed pin, but only while the depot pin
 *   is still unconfirmed (a depot an admin confirmed is never overwritten).
 * - Orders: one CONFIRMED order per customer for the next delivery date. Reruns on a later day,
 *   after those dates have passed, create a fresh set for the then-next delivery date.
 */
export async function seedDemo(
  prisma: DemoDb,
  options: {
    storage?: Storage;
    photos?: boolean;
    now?: Date;
    adminEmail?: string;
    upload?: UploadObject;
    /** Create the orders for today instead of the next delivery day (live demo on the day). */
    ordersForToday?: boolean;
  } = {},
): Promise<DemoSeedSummary> {
  const withPhotos = options.photos ?? true;
  if (withPhotos && !options.storage) throw new Error("seedDemo needs a storage for the photos");
  const now = options.now ?? new Date();
  const upload = options.upload ?? uploadWithPresignedUrl;

  const admin = await prisma.user.findFirst({
    where: options.adminEmail ? { email: options.adminEmail } : { role: "ADMIN" },
    orderBy: { createdAt: "asc" },
  });
  if (!admin) throw new Error("No admin user found: run the base seed (pnpm db:seed) first");

  // Depot.
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!settings) throw new Error("Settings row missing: run the base seed (pnpm db:seed) first");
  let depotUpdated = false;
  if (!settings.depotPinConfirmed) {
    await prisma.settings.update({
      where: { id: 1 },
      data: { ...DEMO_DEPOT, depotPinConfirmed: true },
    });
    depotUpdated = true;
  }

  // Products come from the base seed (the three of the catalog, NUD-138).
  const products = await prisma.product.findMany({ select: { id: true, sku: true, unit: true } });
  const bySku = new Map(products.map((p) => [p.sku, p]));
  for (const sku of DEMO_PRODUCT_SKUS) {
    if (!bySku.has(sku)) throw new Error(`Product ${sku} missing: run the base seed first`);
  }

  // Customers + photos + orders.
  const day = calendarDayIn(now, settings.timezone);
  const today = new Date(Date.UTC(day.y, day.m - 1, day.d));
  const deliveryDate = options.ordersForToday ? today : nextDeliveryDate(now, settings);
  let customersCreated = 0;
  let photosCreated = 0;
  let ordersCreated = 0;
  for (const [index, c] of DEMO_CUSTOMERS.entries()) {
    let customer = await prisma.customer.findUnique({ where: { customerNumber: c.number } });
    if (!customer) {
      customer = await prisma.customer.create({
        data: {
          customerNumber: c.number,
          name: c.name,
          street: c.street,
          postalCode: c.postalCode,
          city: "Wien",
          country: "AT",
          lat: c.lat,
          lng: c.lng,
          pinConfirmed: true,
          deliveryHoursInfo: c.hours ?? null,
          notes: c.note
            ? createLocalizedText(
                {
                  de: c.note.de,
                  "zh-Hans": c.note.hans,
                },
                "de",
                // en / sr-Latn / cs are filled by the translation retry job (needs the providers).
                { pendingTranslation: true },
              )
            : undefined,
        },
      });
      customersCreated += 1;
    }

    if (withPhotos) {
      for (const kind of ["STORE", "PARKING"] as const) {
        const has = await prisma.photo.findFirst({
          where: { customerId: customer.id, kind, isCurrent: true },
          select: { id: true },
        });
        if (has) continue;
        const key = `customers/${demoUuid(`${c.number}:${kind}`)}.png`;
        const png = demoPhotoPng(kind, c.number);
        const stored = await options.storage!.head(key);
        if (!stored || stored.bytes !== png.length) {
          await upload(options.storage!, key, png, "image/png");
        }
        const result = await addCustomerPhoto(prisma, options.storage!, admin.id, {
          customerId: customer.id,
          kind,
          storageKey: key,
          width: 800,
          height: 600,
        });
        if (!result.ok) throw new Error(`Photo ${c.number}/${kind} not saved: ${result.error}`);
        photosCreated += 1;
      }
    }

    const hasOrder = await prisma.order.findFirst({
      where: {
        customerId: customer.id,
        internalNote: DEMO_ORDER_NOTE,
        deliveryDate: { gte: today },
      },
      select: { id: true },
    });
    if (!hasOrder) {
      const lines = demoOrderLines(index);
      await prisma.order.create({
        data: {
          customerId: customer.id,
          deliveryDate,
          status: "CONFIRMED",
          source: "MANUAL",
          internalNote: DEMO_ORDER_NOTE,
          createdById: admin.id,
          items: {
            create: lines.map((l) => ({ productId: bySku.get(l.sku)!.id, quantity: l.quantity })),
          },
        },
      });
      ordersCreated += 1;
    }
  }

  return {
    deliveryDate: deliveryDate.toISOString().slice(0, 10),
    depotUpdated,
    customersCreated,
    photosCreated,
    ordersCreated,
  };
}
