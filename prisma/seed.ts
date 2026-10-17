import "dotenv/config";

import bcrypt from "bcryptjs";

import { PrismaClient, type Unit } from "../src/generated/prisma/client";
import { createLocalizedText } from "../src/lib/localized-text";
import { createPrismaClient } from "../src/server/db";

const DRIVERS = [
  { username: "fahrer-de", displayName: "Fahrer Deutsch", locale: "de" },
  { username: "driver-hans", displayName: "司机 简体", locale: "zh_Hans" },
  { username: "driver-hk", displayName: "司機 香港", locale: "zh_Hant_HK" },
  { username: "driver-tw", displayName: "司機 台灣", locale: "zh_Hant_TW" },
] as const;

const PRODUCTS: {
  sku: string;
  unit: Unit;
  de: string;
  hans: string;
  hant: string;
}[] = [
  {
    sku: "SPAG-5",
    unit: "PACK",
    de: "Spaghetti 5 kg",
    hans: "意大利直面 5公斤",
    hant: "義大利直麵 5公斤",
  },
  { sku: "PENN-5", unit: "PACK", de: "Penne 5 kg", hans: "笔管面 5公斤", hant: "筆管麵 5公斤" },
  {
    sku: "TAGL-3",
    unit: "PACK",
    de: "Tagliatelle 3 kg",
    hans: "宽面条 3公斤",
    hant: "寬麵條 3公斤",
  },
  { sku: "FUSI-5", unit: "PACK", de: "Fusilli 5 kg", hans: "螺旋面 5公斤", hant: "螺旋麵 5公斤" },
  {
    sku: "LASA-2",
    unit: "CRATE",
    de: "Lasagneplatten, Karton",
    hans: "千层面皮 (箱)",
    hant: "千層麵皮 (箱)",
  },
  {
    sku: "RAVI-KG",
    unit: "KG",
    de: "Ravioli Ricotta-Spinat",
    hans: "里科塔菠菜意式饺子",
    hant: "瑞可達菠菜義式餃子",
  },
];

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
        localeChosen: false,
      },
    });
  }

  for (const [index, p] of PRODUCTS.entries()) {
    const name = createLocalizedText(
      { de: p.de, "zh-Hans": p.hans, "zh-Hant-HK": p.hant, "zh-Hant-TW": p.hant },
      "de",
    );
    await prisma.product.upsert({
      where: { sku: p.sku },
      update: {},
      create: { sku: p.sku, unit: p.unit, name, sortOrder: index },
    });
  }
}

if (process.argv[1]?.endsWith("seed.ts")) {
  const prisma = createPrismaClient();
  seed(prisma)
    .then(() => console.log("Seed finished"))
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
