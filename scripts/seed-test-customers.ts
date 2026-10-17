import "dotenv/config";

import { createPrismaClient } from "../src/server/db";
import { seedTestCustomers } from "../src/server/testing/seed-customers";

/** Dev/demo helper: `pnpm db:seed:customers [count]` adds fake customers (prefix T-). Not part of `db:seed`. */
async function main() {
  const count = Number(process.argv[2] ?? 500);
  const prisma = createPrismaClient();
  try {
    const admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
    const n = await seedTestCustomers(prisma, { count, uploadedById: admin?.id });
    console.log(`Seeded ${n} test customers (numbers T-0001 ...).`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
