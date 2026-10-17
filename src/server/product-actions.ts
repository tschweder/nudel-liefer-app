"use server";

import { hansToHk, hansToTw } from "@/lib/opencc";

import { requireRole } from "./auth/guards";
import { getDb } from "./db";
import {
  createProduct,
  moveProduct,
  type ProductSaveResult,
  setProductActive,
  updateProduct,
} from "./products";

/** Admin-only server actions for the product catalog (soft delete only). */

export async function createProductAction(input: unknown): Promise<ProductSaveResult> {
  await requireRole("ADMIN");
  return createProduct(getDb(), input);
}

export async function updateProductAction(id: unknown, input: unknown): Promise<ProductSaveResult> {
  await requireRole("ADMIN");
  return updateProduct(getDb(), id, input);
}

export async function setProductActiveAction(id: unknown, active: unknown) {
  await requireRole("ADMIN");
  return setProductActive(getDb(), id, active);
}

export async function moveProductAction(id: unknown, direction: unknown) {
  await requireRole("ADMIN");
  return moveProduct(getDb(), id, direction);
}

/**
 * Live OpenCC pre-fill for the product form: Simplified -> Hong Kong and Taiwan Traditional.
 * Runs on the server so the multi-hundred-KB OpenCC dictionaries stay out of the browser bundle.
 */
export async function deriveHantAction(
  hans: unknown,
): Promise<{ ok: true; hk: string; tw: string } | { ok: false }> {
  await requireRole("ADMIN");
  if (typeof hans !== "string" || hans.length > 160) return { ok: false };
  return { ok: true, hk: hansToHk(hans), tw: hansToTw(hans) };
}
