import type { Unit } from "@/generated/prisma/client";

/**
 * The owner's three real products (NUD-138, F5). One source for the base seed, the demo seed and
 * the tests; the migration `20261026180000_product_catalog_weight` creates the same SKUs.
 * `weightKgPerUnit` is only the starting value: admins edit it on the product form, and the seed
 * never overwrites an existing row.
 */
export const CATALOG_PRODUCTS: readonly {
  sku: string;
  unit: Unit;
  weightKgPerUnit: number;
  de: string;
  hans: string;
  hant: string;
}[] = [
  {
    sku: "NUDELN-BEUTEL",
    unit: "PACK",
    weightKgPerUnit: 3,
    de: "Nudeln",
    hans: "面条",
    hant: "麵條",
  },
  {
    sku: "NUDELN-KARTON",
    unit: "CRATE",
    weightKgPerUnit: 10,
    de: "Nudeln",
    hans: "面条",
    hant: "麵條",
  },
  {
    sku: "WANTAN-TEIG",
    unit: "PIECE",
    weightKgPerUnit: 5,
    de: "Wantan-Teig",
    hans: "馄饨皮",
    hant: "餛飩皮",
  },
];

export const CATALOG_SKUS = CATALOG_PRODUCTS.map((p) => p.sku);
