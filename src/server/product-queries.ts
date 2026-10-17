import { requireRole } from "./auth/guards";
import { getDb } from "./db";
import { getActiveProducts, getProduct, listProducts } from "./products";

/** Admin-only reads; each re-checks the role against the database first. */
export async function listProductsQuery() {
  await requireRole("ADMIN");
  return listProducts(getDb());
}

/** Active products for the order entry picker (NUD-030), in sort order. */
export async function activeProductsQuery() {
  await requireRole("ADMIN");
  return getActiveProducts(getDb());
}

export async function getProductQuery(id: unknown) {
  await requireRole("ADMIN");
  return getProduct(getDb(), id);
}
