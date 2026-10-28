/**
 * Pure rules and messages of the dedicated end-to-end database (NUD-162). No I/O, no framework
 * imports: the Playwright specs only need the message builders, `playwright.config.ts` needs the
 * URL guard and `scripts/e2e-database.ts` runs the lifecycle. Everything here is unit-tested.
 *
 * Why: `late-orders.spec.ts` and `mvp-happy-path.spec.ts` own "today" of the database they read and
 * `tour-split.spec.ts` plans a whole day, so they can only run against a database that is seeded
 * and free of foreign tours. The documented way to get one is `E2E_DATABASE_URL` plus
 * `pnpm e2e:db:reset`; these messages name the database and that command instead of aborting with
 * a bare "Precondition failed" or an unrelated assertion.
 */
import { databaseIdentity } from "./backup";

/** The suite uses this instead of `DATABASE_URL`; `playwright.config.ts` copies it into it. */
export const E2E_DATABASE_VAR = "E2E_DATABASE_URL";
export const E2E_DB_RESET_COMMAND = "pnpm e2e:db:reset";
export const E2E_DB_DOC = "docs/e2e-database.md";

/**
 * Variables that may point at a database with (real or the developer's) data. `pnpm e2e:db:reset`
 * drops everything in the e2e database, so it must never be the same database as one of them.
 */
export const PROTECTED_DATABASE_VARS = [
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "BACKUP_DATABASE_URL",
  "RESTORE_DATABASE_URL",
  "PARKING_IMPORT_DATABASE_URL",
] as const;

export type Env = Record<string, string | undefined>;

/** `host:port/database` of a Postgres URL (no credentials), or null when it is not usable as one. */
export function databaseIdentityOf(url: string | undefined): string | null {
  const value = url?.trim();
  if (!value || !/^postgres(ql)?:\/\//i.test(value)) return null;
  try {
    const identity = databaseIdentity(value);
    // `databaseIdentity` happily returns "host:5432/" for a URL without a database name.
    return identity.endsWith("/") ? null : identity;
  } catch {
    return null;
  }
}

export type E2eDatabaseResolution =
  { ok: true; url: string; identity: string } | { ok: false; errors: string[] };

/**
 * Reads and checks `E2E_DATABASE_URL`. Error texts name variables and the command to fix them and
 * never echo a password (only `host:port/database`).
 */
export function resolveE2eDatabase(env: Env): E2eDatabaseResolution {
  const url = env[E2E_DATABASE_VAR]?.trim();
  if (!url) {
    return {
      ok: false,
      errors: [
        `${E2E_DATABASE_VAR} is not set. The specs that own "today" (late-orders, mvp-happy-path) and ` +
          `the planning spec (tour-split) need a database of their own: create one (e.g. ` +
          `\`createdb nudel_e2e\`), put ${E2E_DATABASE_VAR}=postgresql://…/nudel_e2e in .env, then ` +
          `run \`${E2E_DB_RESET_COMMAND}\` (see ${E2E_DB_DOC}).`,
      ],
    };
  }
  const identity = databaseIdentityOf(url);
  if (!identity) {
    return {
      ok: false,
      errors: [
        `${E2E_DATABASE_VAR} must be a postgresql:// connection string with a host and a database ` +
          `name (like DATABASE_URL), but it does not look like one.`,
      ],
    };
  }
  const errors: string[] = [];
  for (const name of PROTECTED_DATABASE_VARS) {
    const other = databaseIdentityOf(env[name]);
    if (other !== identity) continue;
    errors.push(
      `${E2E_DATABASE_VAR} points at the same database as ${name} (${identity}). ` +
        `\`${E2E_DB_RESET_COMMAND}\` empties its database, so the e2e database must be a database ` +
        `of its own — never the development or production one.`,
    );
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, url, identity };
}

/** ` in localhost:5123/nudel`, or "" when the identity is unknown. */
const inDatabase = (database: string | null) => (database ? ` in ${database}` : "");
const ofDatabase = (database: string | null) => (database ? ` ${database}` : " this database");

const ownDatabaseHint = () =>
  `point the suite at a database of its own: set ${E2E_DATABASE_VAR} in .env and run ` +
  `\`${E2E_DB_RESET_COMMAND}\` (see ${E2E_DB_DOC})`;

/** No `DATABASE_URL` in the Playwright process: the spec cannot read the database at all. */
export function databaseUrlMissingMessage(): string {
  return (
    "Precondition failed: DATABASE_URL is not set in the Playwright process, so this spec cannot " +
    "read the database. Put it in .env (Playwright loads .env) or in the shell. Alternatively, " +
    `${ownDatabaseHint()}.`
  );
}

/**
 * Another spec or a manual run already created a tour for the day this spec owns. It removes only
 * what it created, so the assertions on "the tour of the day" become meaningless.
 */
export function dayTourConflictMessage(input: {
  count: number;
  day: string;
  database: string | null;
  /** The day is "today" of the factory time zone (the wording is what the operator searches for). */
  today?: boolean;
}): string {
  const tours = input.count === 1 ? "1 tour already exists" : `${input.count} tours already exist`;
  const day = input.today ? `today (${input.day})` : input.day;
  return (
    `Precondition failed: this spec needs a day of its own, but ${tours} for ${day}` +
    `${inDatabase(input.database)}. A foreign tour would make its assertions meaningless — ` +
    `${ownDatabaseHint()}.`
  );
}

/** `pnpm db:seed` (or a migration) has not put everything into this database. */
export function seedDataMissingMessage(input: {
  database: string | null;
  missing: readonly string[];
}): string {
  const missing = input.missing.join(", ");
  return (
    `Precondition failed:${ofDatabase(input.database)} is not seeded — missing ${missing}. ` +
    "Run `pnpm db:seed` (`--demo --no-photos` adds the demo depot, drivers and customers). " +
    `Alternatively, ${ownDatabaseHint()}.`
  );
}

/** The demo seed (`pnpm db:seed --demo`) is required: confirmed depot pin, demo drivers, vehicles. */
export function demoSeedMissingMessage(input: { database: string | null; reason: string }): string {
  return (
    `Precondition failed: ${input.reason}${inDatabase(input.database)}. This spec needs the demo ` +
    "seed (a confirmed depot pin and the demo drivers). Run `pnpm db:seed --demo --no-photos` on " +
    `this database. Alternatively, ${ownDatabaseHint()}.`
  );
}

/** The database is behind `prisma/migrations`, so app and spec read different tables/columns. */
export function migrationDriftMessage(input: {
  database: string | null;
  migrations: readonly string[];
}): string {
  const count = input.migrations.length;
  const names = input.migrations.slice(0, 5).join(", ");
  const more = count > 5 ? `, … (${count - 5} more)` : "";
  return (
    `Precondition failed:${ofDatabase(input.database)} has not applied ${count} migration${
      count === 1 ? "" : "s"
    } of prisma/migrations: ${names}${more}. Run \`pnpm db:migrate\` on it (or ` +
    `\`${E2E_DB_RESET_COMMAND}\` for the e2e database, see ${E2E_DB_DOC}) before running the specs.`
  );
}
