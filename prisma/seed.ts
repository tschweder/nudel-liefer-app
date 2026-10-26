import "dotenv/config";

import bcrypt from "bcryptjs";

import { PrismaClient } from "../src/generated/prisma/client";
import { createLocalizedText } from "../src/lib/localized-text";
import { createPrismaClient } from "../src/server/db";
import { assertDemoStorageConfigured, seedDemo } from "../src/server/demo-seed";
import { CATALOG_PRODUCTS } from "../src/server/product-catalog";
import { getStorage } from "../src/server/storage";

// `localeChosen`: the language demo drivers already have their language (they skip the
// first-start picker, which keeps e2e logins deterministic); `driver-new` shows the picker (NUD-050).
const DRIVERS = [
  { username: "fahrer-de", displayName: "Fahrer Deutsch", locale: "de", localeChosen: true },
  { username: "driver-hans", displayName: "司机 简体", locale: "zh_Hans", localeChosen: true },
  { username: "driver-en", displayName: "Driver English", locale: "en", localeChosen: true },
  { username: "driver-sr", displayName: "Vozač Srpski", locale: "sr_Latn", localeChosen: true },
  { username: "driver-cs", displayName: "Řidič Česky", locale: "cs", localeChosen: true },
  { username: "driver-new", displayName: "Neuer Fahrer", locale: "de", localeChosen: false },
] as const;

/** Seeds core data. Idempotent: safe to run repeatedly on the same database. */
export async function seed(prisma: PrismaClient = createPrismaClient()) {
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminPassword) throw new Error("SEED_ADMIN_PASSWORD is not set (see .env.example)");
  const adminEmail = process.env.SEED_ADMIN_EMAIL || "admin@example.com";
  // Demo drivers share one well-known PIN: never create them on production (SEED_DRIVERS=false).
  const withDrivers = process.env.SEED_DRIVERS !== "false";
  const driverPin = process.env.SEED_DRIVER_PIN ?? "123456";
  if (!/^\d{6}$/.test(driverPin)) throw new Error("SEED_DRIVER_PIN must be exactly 6 digits");

  await prisma.settings.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      depotName: "Nudelfabrik (placeholder)",
      depotAddress: "Stephansplatz 1, 1010 Wien",
      depotLat: 48.2082,
      depotLng: 16.3738,
      // Placeholder location: an admin must confirm the real depot pin in Settings (NUD-012).
      depotPinConfirmed: false,
      timezone: "Europe/Vienna",
    },
  });

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      role: "ADMIN",
      email: adminEmail,
      passwordHash: await bcrypt.hash(adminPassword, 10),
      displayName: "Admin",
      locale: "de",
      localeChosen: true,
    },
  });

  const pinHash = await bcrypt.hash(driverPin, 10);
  for (const driver of withDrivers ? DRIVERS : []) {
    await prisma.user.upsert({
      where: { username: driver.username },
      update: {},
      create: {
        role: "DRIVER",
        username: driver.username,
        passwordHash: pinHash,
        displayName: driver.displayName,
        locale: driver.locale,
        localeChosen: driver.localeChosen,
      },
    });
  }

  for (const [index, p] of CATALOG_PRODUCTS.entries()) {
    const name = createLocalizedText(
      { de: p.de, en: p.en, "sr-Latn": p.sr, cs: p.cs, "zh-Hans": p.hans },
      "de",
      { machine: { en: true, "sr-Latn": true, cs: true } },
    );
    // The NUD-138 migration creates the catalog with de + zh-Hans only and NUD-140 flags it pending;
    // fill the other locales from the seed unless the owner already changed the name.
    const existing = await prisma.product.findUnique({ where: { sku: p.sku } });
    const meta = (existing?.name as { meta?: { pendingTranslation?: boolean } } | null)?.meta;
    if (existing && meta?.pendingTranslation) {
      await prisma.product.update({ where: { sku: p.sku }, data: { name } });
    }
    await prisma.product.upsert({
      where: { sku: p.sku },
      update: {},
      create: {
        sku: p.sku,
        unit: p.unit,
        name,
        weightKgPerUnit: p.weightKgPerUnit,
        sortOrder: index,
      },
    });
  }
}

if (process.argv[1]?.endsWith("seed.ts")) {
  const prisma = createPrismaClient();
  const args = process.argv.slice(2);
  const demo = args.includes("--demo");
  const photos = !args.includes("--no-photos");
  const ordersForToday = args.includes("--today");
  const unknown = args.filter((a) => !["--demo", "--no-photos", "--today"].includes(a));
  if (unknown.length > 0 || (!demo && (!photos || ordersForToday))) {
    console.error("Usage: pnpm db:seed [--demo [--no-photos] [--today]]");
    process.exit(1);
  }
  (async () => {
    // Fail before anything is written when the photos cannot be stored (NUD-060).
    if (demo && photos) assertDemoStorageConfigured(process.env);
    await seed(prisma);
    console.log("Seed finished");
    if (demo) {
      const summary = await seedDemo(prisma, {
        photos,
        ordersForToday,
        storage: photos ? getStorage() : undefined,
        adminEmail: process.env.SEED_ADMIN_EMAIL || "admin@example.com",
      });
      console.log("Demo seed finished", summary);
    }
  })()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
