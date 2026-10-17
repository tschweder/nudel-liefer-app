import "dotenv/config";

import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Not required for `prisma generate`; required for migrate/seed. Migrations need a direct
    // (non-pooled) connection on Neon: DATABASE_URL_UNPOOLED wins when it is set.
    url: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || "",
  },
});
