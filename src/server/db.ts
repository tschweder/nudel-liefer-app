import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

export function createPrismaClient(connectionString = process.env.DATABASE_URL, schema?: string) {
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  // With a schema (tests) also put it on the connection's search_path: raw SQL, triggers and SQL
  // functions use unqualified names (the adapter only qualifies the tables of generated queries).
  const adapter = new PrismaPg(
    schema ? { connectionString, options: `-c search_path=${schema}` } : { connectionString },
    schema ? { schema } : undefined,
  );
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** Singleton Prisma client (re-used across hot reloads in dev); created lazily on first use. */
export function getDb(): PrismaClient {
  return (globalForPrisma.prisma ??= createPrismaClient());
}
