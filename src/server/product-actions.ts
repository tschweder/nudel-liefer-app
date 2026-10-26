"use server";

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
