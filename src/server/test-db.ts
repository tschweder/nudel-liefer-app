import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { Client } from "pg";

import type { PrismaClient } from "@/generated/prisma/client";

import { createPrismaClient } from "./db";

const MIGRATIONS_DIR = join(process.cwd(), "prisma", "migrations");

export interface TestDb {
  prisma: PrismaClient;
  schema: string;
  teardown: () => Promise<void>;
}

/**
 * Creates an isolated Postgres schema in `DATABASE_URL`, applies all committed migrations
 * to it and returns a Prisma client bound to that schema. Test-only helper.
 */
export async function createTestDb(): Promise<TestDb> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const schema = `test_${randomBytes(6).toString("hex")}`;

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    const dirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    for (const dir of dirs) {
      await client.query(readFileSync(join(MIGRATIONS_DIR, dir, "migration.sql"), "utf8"));
    }
  } finally {
    await client.end();
  }

  const prisma = createPrismaClient(url, schema);
  return {
    prisma,
    schema,
    teardown: async () => {
      await prisma.$disconnect();
      const c = new Client({ connectionString: url });
      await c.connect();
      await c.query(`DROP SCHEMA "${schema}" CASCADE`);
      await c.end();
    },
  };
}
