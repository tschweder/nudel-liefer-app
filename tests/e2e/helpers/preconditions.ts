/**
 * Database preconditions of the specs that need a specific day or the seeded/demo data (NUD-162).
 *
 * They abort before the first browser step with a message that names the database, what is missing
 * and the command that fixes it — instead of a bare "Precondition failed", a `TypeError` on an
 * undefined product row, or an unrelated assertion such as "0 tour tabs". The message texts are pure
 * (`scripts/lib/e2e-database.ts`); this module only reads the database.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";

import type { Client } from "pg";

import {
  databaseIdentityOf,
  databaseUrlMissingMessage,
  dayTourConflictMessage,
  migrationDriftMessage,
  seedDataMissingMessage,
} from "../../../scripts/lib/e2e-database";

type MigrationRow = { migration_name: string };
type CountRow = { count: string };

export type DatabaseNeeds = {
  /** The spec logs in as the seeded admin. */
  admin?: boolean;
  /** Catalog products (`Product.sku`) the spec orders or plans with. */
  skus?: readonly string[];
};

/** `DATABASE_URL` of the Playwright process, or a message that says what to set. */
export function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url?.trim()) throw new Error(databaseUrlMissingMessage());
  return url;
}

/** The database this spec actually talks to, as `host:port/name` (no credentials). */
export function currentDatabase(): string | null {
  return databaseIdentityOf(process.env.DATABASE_URL);
}

/** Migration folders of `prisma/migrations` that the database has not applied yet (oldest first). */
export async function unappliedMigrations(db: Client): Promise<string[]> {
  let folders: string[];
  try {
    folders = readdirSync(join(process.cwd(), "prisma", "migrations"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^\d{14}_/.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return []; // no migrations on disk: nothing to compare against
  }
  if (folders.length === 0) return [];
  let applied: string[];
  try {
    const result = await db.query<MigrationRow>(
      `SELECT "migration_name" FROM "_prisma_migrations"
        WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL`,
    );
    applied = result.rows.map((row) => row.migration_name);
  } catch {
    applied = []; // not even the migration table: an empty, unmigrated database
  }
  const done = new Set(applied);
  return folders.filter((name) => !done.has(name));
}

/** What the base seed (`pnpm db:seed`) has not put into this database yet; empty = seeded. */
export async function missingSeedData(db: Client, needs: DatabaseNeeds = {}): Promise<string[]> {
  const missing: string[] = [];
  if ((await db.query(`SELECT 1 FROM "Settings" WHERE "id"=1`)).rows.length === 0) {
    missing.push("the Settings row");
  }
  if (needs.admin) {
    const admins = await db.query(`SELECT 1 FROM "User" WHERE "role"='ADMIN' AND "active"`);
    if (admins.rows.length === 0) missing.push("an active ADMIN user");
  }
  for (const sku of needs.skus ?? []) {
    const product = await db.query(`SELECT 1 FROM "Product" WHERE "sku"=$1`, [sku]);
    if (product.rows.length === 0) missing.push(`product ${sku}`);
  }
  return missing;
}

/**
 * Aborts when the database is behind `prisma/migrations` or lacks the base seed. Returns the
 * database identity, so callers can pass it to the other messages.
 */
export async function requireUsableDatabase(
  db: Client,
  needs: DatabaseNeeds = {},
): Promise<string | null> {
  const database = currentDatabase();
  const drift = await unappliedMigrations(db);
  if (drift.length > 0) throw new Error(migrationDriftMessage({ database, migrations: drift }));
  const missing = await missingSeedData(db, needs);
  if (missing.length > 0) throw new Error(seedDataMissingMessage({ database, missing }));
  return database;
}

/**
 * The spec owns this day: anything else that already has a tour there would make its assertions
 * (tour tabs, stop rows, the follow-up tour) meaningless.
 */
export async function requireFreeDay(
  db: Client,
  day: string,
  options: { today?: boolean } = {},
): Promise<void> {
  const count = await db.query<CountRow>(`SELECT count(*) FROM "Tour" WHERE "date"=$1`, [day]);
  const tours = Number(count.rows[0]?.count ?? 0);
  if (tours === 0) return;
  throw new Error(
    dayTourConflictMessage({
      count: tours,
      day,
      database: currentDatabase(),
      today: options.today,
    }),
  );
}
