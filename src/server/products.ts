import { z } from "zod";

import { parseWeightKg } from "@/domain/weight";
import { Prisma, type PrismaClient, type Unit } from "@/generated/prisma/client";
import { createLocalizedText, type LocalizedText, localizedTextSchema } from "@/lib/localized-text";
import { hansToHk, hansToTw } from "@/lib/opencc";
import { UNITS } from "@/lib/units";

type ProductDb = Pick<PrismaClient, "product" | "orderItem" | "$transaction">;

const requiredText = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .default("")
    .transform((v) => v);

/**
 * Product form input. `de` and `zh-Hans` are required. A Traditional name that is flagged `auto`
 * (or left empty) is derived from `zh-Hans` on the server with OpenCC, so the stored value never
 * depends on what the client computed; a non-auto, non-empty value is a hand-edited name.
 */
export const productInputSchema = z.object({
  sku: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/)
    .transform((v) => v.toUpperCase()),
  unit: z.enum(UNITS),
  /** Weight of one unit in kg (NUD-138): "3", "2,5" or a number; must be > 0. */
  weightKgPerUnit: z.union([z.string().max(12), z.number()]).transform((v, ctx) => {
    const parsed = parseWeightKg(v);
    if (parsed === null) ctx.addIssue({ code: "custom", message: "invalid weight" });
    return parsed ?? 0;
  }),
  name: z.object({
    de: requiredText(160),
    hans: requiredText(160),
    hk: optionalText(160),
    tw: optionalText(160),
  }),
  hkAuto: z.boolean().default(false),
  twAuto: z.boolean().default(false),
});
export type ProductInput = z.input<typeof productInputSchema>;

export type ProductSaveResult =
  | { ok: true; id: string }
  | { ok: false; error: "invalid" | "sku_taken" | "not_found" | "unit_locked" };

const idSchema = z.string().trim().min(1).max(64);

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002"
  );
}

/** Builds the stored LocalizedText from validated form values (source language: German). */
export function buildProductName(v: z.output<typeof productInputSchema>): LocalizedText {
  const machine: Partial<Record<"zh-Hant-HK" | "zh-Hant-TW", boolean>> = {};
  let hk = v.name.hk;
  let tw = v.name.tw;
  if (v.hkAuto || hk === "") {
    hk = hansToHk(v.name.hans);
    machine["zh-Hant-HK"] = true;
  }
  if (v.twAuto || tw === "") {
    tw = hansToTw(v.name.hans);
    machine["zh-Hant-TW"] = true;
  }
  return createLocalizedText(
    { de: v.name.de, "zh-Hans": v.name.hans, "zh-Hant-HK": hk, "zh-Hant-TW": tw },
    "de",
    { machine },
  );
}

/** Name as the form needs it (strings per locale plus the "auto" flags). */
export type ProductFormValues = {
  sku: string;
  unit: Unit;
  /** Kilograms per unit as the form edits it ("3", "2.5"). */
  weightKgPerUnit: string;
  de: string;
  hans: string;
  hk: string;
  tw: string;
  hkAuto: boolean;
  twAuto: boolean;
};

export function toFormValues(row: {
  sku: string;
  unit: Unit;
  weightKgPerUnit: { toString(): string };
  name: unknown;
}): ProductFormValues {
  const parsed = localizedTextSchema.safeParse(row.name);
  const name = parsed.success ? parsed.data : null;
  return {
    sku: row.sku,
    unit: row.unit,
    weightKgPerUnit: trimWeight(row.weightKgPerUnit.toString()),
    de: name?.de ?? "",
    hans: name?.["zh-Hans"] ?? "",
    hk: name?.["zh-Hant-HK"] ?? "",
    tw: name?.["zh-Hant-TW"] ?? "",
    hkAuto: name?.meta.machine["zh-Hant-HK"] === true,
    twAuto: name?.meta.machine["zh-Hant-TW"] === true,
  };
}

/** "3.00" -> "3", "2.50" -> "2.5" (the form shows what the admin typed, not the column scale). */
function trimWeight(text: string): string {
  return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
}

const asJson = (name: LocalizedText) => name as unknown as Prisma.InputJsonValue;

async function skuTaken(db: ProductDb, sku: string, exceptId?: string): Promise<boolean> {
  const hit = await db.product.findFirst({
    where: {
      sku: { equals: sku, mode: "insensitive" },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });
  return hit !== null;
}

/** Creates a product at the end of the list. The caller checked the role. */
export async function createProduct(db: ProductDb, rawInput: unknown): Promise<ProductSaveResult> {
  const parsed = productInputSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;
  if (await skuTaken(db, v.sku)) return { ok: false, error: "sku_taken" };
  try {
    const last = await db.product.aggregate({ _max: { sortOrder: true } });
    const row = await db.product.create({
      data: {
        sku: v.sku,
        unit: v.unit,
        weightKgPerUnit: v.weightKgPerUnit,
        name: asJson(buildProductName(v)),
        sortOrder: (last._max.sortOrder ?? -1) + 1,
      },
      select: { id: true },
    });
    return { ok: true, id: row.id };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: "sku_taken" };
    throw error;
  }
}

/**
 * Updates a product. The unit cannot change once the product is on an order: old quantities
 * would silently change their meaning (correct quantities are priority 2).
 */
export async function updateProduct(
  db: ProductDb,
  rawId: unknown,
  rawInput: unknown,
): Promise<ProductSaveResult> {
  const id = idSchema.safeParse(rawId);
  const parsed = productInputSchema.safeParse(rawInput);
  if (!id.success || !parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;
  const stored = await db.product.findUnique({ where: { id: id.data } });
  if (!stored) return { ok: false, error: "not_found" };
  if (await skuTaken(db, v.sku, stored.id)) return { ok: false, error: "sku_taken" };
  if (v.unit !== stored.unit) {
    const used = await db.orderItem.count({ where: { productId: stored.id } });
    if (used > 0) return { ok: false, error: "unit_locked" };
  }
  try {
    await db.product.update({
      where: { id: stored.id },
      data: {
        sku: v.sku,
        unit: v.unit,
        weightKgPerUnit: v.weightKgPerUnit,
        name: asJson(buildProductName(v)),
      },
    });
    return { ok: true, id: stored.id };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: "sku_taken" };
    throw error;
  }
}

/** Deactivate / reactivate (soft delete). Old orders keep referencing the product. */
export async function setProductActive(
  db: ProductDb,
  rawId: unknown,
  rawActive: unknown,
): Promise<{ ok: true } | { ok: false; error: "invalid" | "not_found" }> {
  const id = idSchema.safeParse(rawId);
  const active = z.boolean().safeParse(rawActive);
  if (!id.success || !active.success) return { ok: false, error: "invalid" };
  const result = await db.product.updateMany({
    where: { id: id.data },
    data: { active: active.data },
  });
  return result.count === 0 ? { ok: false, error: "not_found" } : { ok: true };
}

/**
 * Moves a product one place up or down in the full list (active and inactive together) and
 * renumbers `sortOrder` to 0..n-1, which also repairs ties. No-op at the ends.
 */
export async function moveProduct(
  db: ProductDb,
  rawId: unknown,
  rawDirection: unknown,
): Promise<{ ok: true } | { ok: false; error: "invalid" | "not_found" }> {
  const id = idSchema.safeParse(rawId);
  const direction = z.enum(["up", "down"]).safeParse(rawDirection);
  if (!id.success || !direction.success) return { ok: false, error: "invalid" };
  return db.$transaction(async (tx) => {
    const rows = await tx.product.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: { id: true, sortOrder: true },
    });
    const index = rows.findIndex((r) => r.id === id.data);
    if (index === -1) return { ok: false as const, error: "not_found" as const };
    const target = direction.data === "up" ? index - 1 : index + 1;
    if (target >= 0 && target < rows.length) {
      const [moved] = rows.splice(index, 1);
      rows.splice(target, 0, moved!);
    }
    for (const [position, row] of rows.entries()) {
      if (row.sortOrder !== position) {
        await tx.product.update({ where: { id: row.id }, data: { sortOrder: position } });
      }
    }
    return { ok: true as const };
  });
}

export type ProductRow = {
  id: string;
  sku: string;
  unit: Unit;
  /** Kilograms per unit (NUD-138). */
  weightKgPerUnit: number;
  active: boolean;
  sortOrder: number;
  name: LocalizedText;
};

function toRow(row: {
  id: string;
  sku: string;
  unit: Unit;
  weightKgPerUnit: { toString(): string };
  active: boolean;
  sortOrder: number;
  name: unknown;
}): ProductRow {
  const parsed = localizedTextSchema.safeParse(row.name);
  return {
    id: row.id,
    sku: row.sku,
    unit: row.unit,
    weightKgPerUnit: Number(row.weightKgPerUnit.toString()),
    active: row.active,
    sortOrder: row.sortOrder,
    name: parsed.success ? parsed.data : createLocalizedText({ de: row.sku }, "de"), // corrupt JSON: never crash the list
  };
}

const ORDER = [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }] as const;

/** All products for the admin list (active and inactive), in `sortOrder`. */
export async function listProducts(db: Pick<PrismaClient, "product">): Promise<ProductRow[]> {
  const rows = await db.product.findMany({ orderBy: [...ORDER] });
  return rows.map(toRow);
}

/**
 * Products offered by the order entry picker (NUD-030): active only, in `sortOrder`. Inactive
 * products stay readable on old orders through their `productId` but are never offered here.
 */
export async function getActiveProducts(db: Pick<PrismaClient, "product">): Promise<ProductRow[]> {
  const rows = await db.product.findMany({ where: { active: true }, orderBy: [...ORDER] });
  return rows.map(toRow);
}

export async function getProduct(
  db: Pick<PrismaClient, "product">,
  rawId: unknown,
): Promise<(ProductFormValues & { id: string; active: boolean; unitLocked: boolean }) | null> {
  const id = idSchema.safeParse(rawId);
  if (!id.success) return null;
  const row = await db.product.findUnique({
    where: { id: id.data },
    include: { _count: { select: { orderItems: true } } },
  });
  if (!row) return null;
  return {
    id: row.id,
    active: row.active,
    unitLocked: row._count.orderItems > 0,
    ...toFormValues(row),
  };
}
