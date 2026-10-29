/**
 * One-off data hygiene for the demo database (NUD-188, QA 2026-10-29 F16).
 *
 * The report found test debris in every picker: `A3 Prueffahrer` (x3), `E2E Fahrer` (x2), the retired
 * locales `司機 台灣` / `司機 香港`, eight `Osteria 1 e2es…` customers, three `E2E …` vehicles and five
 * `A3 Prüfnudel` products. E2E runs before NUD-162 wrote into the demo database and never cleaned up;
 * the A3 rows were created by hand through the admin UI.
 *
 * This script ONLY deactivates (soft delete, §4.3: never hard-delete business data) and it never
 * touches orders, stops or tours. It is idempotent: a row that is already inactive stays as it is.
 *
 *   node_modules\.bin\tsx.cmd scripts/archive-test-data.ts            # dry run, prints what it would do
 *   node_modules\.bin\tsx.cmd scripts/archive-test-data.ts --apply    # writes
 */
import "dotenv/config";

import { getDb } from "../src/server/db";

const APPLY = process.argv.includes("--apply");

const DRIVER_WHERE = {
  role: "DRIVER" as const,
  OR: [
    { username: { startsWith: "e2e-" } },
    { username: { startsWith: "a3-" } },
    { displayName: { startsWith: "E2E " } },
    { displayName: { startsWith: "A3 Pruef" } },
    { displayName: { startsWith: "A3 Prüf" } },
    // retried locales of the removed Traditional-Chinese build (D21)
    { username: "driver-tw" },
    { username: "driver-hk" },
  ],
};

const CUSTOMER_WHERE = {
  OR: [
    { customerNumber: { startsWith: "e2es" } },
    { name: { contains: "e2es" } },
    { name: { startsWith: "A3 " } },
  ],
};

const VEHICLE_WHERE = {
  OR: [{ id: { startsWith: "veh-e2e" } }, { name: { startsWith: "E2E " } }],
};

const PRODUCT_WHERE = {
  OR: [{ sku: { startsWith: "A3V" } }, { sku: { startsWith: "SPAG-" } }, { sku: "GNOC-2" }],
};

async function main() {
  const db = getDb();

  const drivers = await db.user.findMany({
    where: { ...DRIVER_WHERE, active: true },
    select: { id: true, username: true, displayName: true },
  });
  const customers = await db.customer.findMany({
    where: { ...CUSTOMER_WHERE, active: true },
    select: { id: true, customerNumber: true, name: true },
  });
  const vehicles = await db.vehicle.findMany({
    where: { ...VEHICLE_WHERE, active: true },
    select: { id: true, name: true },
  });
  const products = await db.product.findMany({
    where: { ...PRODUCT_WHERE, active: true },
    select: { id: true, sku: true },
  });

  console.log(`drivers   ${drivers.length}: ${drivers.map((d) => d.displayName).join(", ")}`);
  console.log(
    `customers ${customers.length}: ${customers.map((c) => c.customerNumber).join(", ")}`,
  );
  console.log(`vehicles  ${vehicles.length}: ${vehicles.map((v) => v.name).join(", ")}`);
  console.log(`products  ${products.length}: ${products.map((p) => p.sku).join(", ")}`);

  if (!APPLY) {
    console.log("\ndry run — re-run with --apply to deactivate them (nothing is deleted)");
    return;
  }

  const [u, c, v, p] = await Promise.all([
    db.user.updateMany({
      where: { id: { in: drivers.map((d) => d.id) } },
      data: { active: false },
    }),
    db.customer.updateMany({
      where: { id: { in: customers.map((x) => x.id) } },
      data: { active: false },
    }),
    db.vehicle.updateMany({
      where: { id: { in: vehicles.map((x) => x.id) } },
      data: { active: false },
    }),
    db.product.updateMany({
      where: { id: { in: products.map((x) => x.id) } },
      data: { active: false },
    }),
  ]);
  console.log(
    `\narchived: ${u.count} drivers, ${c.count} customers, ${v.count} vehicles, ${p.count} products`,
  );
  console.log("orders, stops and tours were not touched.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
