import { describe, expect, it } from "vitest";

import {
  databaseIdentityOf,
  databaseUrlMissingMessage,
  dayTourConflictMessage,
  demoSeedMissingMessage,
  E2E_DATABASE_VAR,
  E2E_DB_DOC,
  E2E_DB_RESET_COMMAND,
  migrationDriftMessage,
  resolveE2eDatabase,
  seedDataMissingMessage,
} from "./e2e-database";

const E2E_URL = "postgresql://postgres:postgres@localhost:5123/nudel_e2e";

/** Every message must tell the operator both the command and the guide. */
const expectActionable = (message: string) => {
  expect(message).toContain(E2E_DB_RESET_COMMAND);
  expect(message).toContain(E2E_DB_DOC);
  expect(message).toContain("Precondition failed");
};

describe("databaseIdentityOf", () => {
  it("reduces a URL to host:port/database without credentials", () => {
    expect(databaseIdentityOf(E2E_URL)).toBe("localhost:5123/nudel_e2e");
    expect(databaseIdentityOf("postgres://user:secret@DB.example/Prod?sslmode=require")).toBe(
      "db.example:5432/Prod",
    );
  });
  it("rejects anything that is not a Postgres URL with a database name", () => {
    expect(databaseIdentityOf(undefined)).toBeNull();
    expect(databaseIdentityOf("   ")).toBeNull();
    expect(databaseIdentityOf("mysql://localhost/nudel")).toBeNull();
    expect(databaseIdentityOf("postgresql://localhost:5123")).toBeNull();
    expect(databaseIdentityOf("not a url")).toBeNull();
  });
});

describe("resolveE2eDatabase", () => {
  it("accepts a database of its own", () => {
    expect(resolveE2eDatabase({ E2E_DATABASE_URL: ` ${E2E_URL} ` })).toEqual({
      ok: true,
      url: E2E_URL,
      identity: "localhost:5123/nudel_e2e",
    });
  });

  it("explains how to get an e2e database when the variable is missing", () => {
    const result = resolveE2eDatabase({ DATABASE_URL: "postgresql://localhost:5123/nudel" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain(E2E_DATABASE_VAR);
    expect(result.errors[0]).toContain(E2E_DB_RESET_COMMAND);
    expect(result.errors[0]).toContain(E2E_DB_DOC);
  });

  it("refuses a value that is not a Postgres URL", () => {
    const result = resolveE2eDatabase({ E2E_DATABASE_URL: "mysql://localhost/nudel_e2e" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain(`must be a postgresql:// connection string`);
  });

  it("refuses the same database under another name, port or host spelling", () => {
    for (const name of [
      "DATABASE_URL",
      "DATABASE_URL_UNPOOLED",
      "BACKUP_DATABASE_URL",
      "RESTORE_DATABASE_URL",
      "PARKING_IMPORT_DATABASE_URL",
    ]) {
      const result = resolveE2eDatabase({
        E2E_DATABASE_URL: E2E_URL,
        [name]: "postgres://someone:else@LOCALHOST:5123/nudel_e2e",
      });
      expect(result.ok, name).toBe(false);
      if (!result.ok) {
        expect(result.errors[0]).toContain(name);
        // The password must never end up in an error text or a log.
        expect(result.errors[0]).not.toContain("else");
      }
    }
  });

  it("accepts another database on the same server and ignores unset variables", () => {
    expect(
      resolveE2eDatabase({
        E2E_DATABASE_URL: E2E_URL,
        DATABASE_URL: "postgresql://postgres:postgres@localhost:5123/nudel",
        BACKUP_DATABASE_URL: "",
      }).ok,
    ).toBe(true);
  });
});

describe("precondition messages", () => {
  it("names the day, the count and the database of a tour conflict", () => {
    const today = dayTourConflictMessage({
      count: 1,
      day: "2026-10-26",
      database: "localhost:5123/nudel",
      today: true,
    });
    expect(today).toContain("1 tour already exists for today (2026-10-26) in localhost:5123/nudel");
    expectActionable(today);

    const planned = dayTourConflictMessage({
      count: 3,
      day: "2100-06-03",
      database: null,
      today: false,
    });
    expect(planned).toContain("3 tours already exist for 2100-06-03.");
    expect(planned).not.toContain("2100-06-03 in ");
    expectActionable(planned);
  });

  it("lists what the seed has not created", () => {
    const message = seedDataMissingMessage({
      database: "localhost:5123/nudel",
      missing: ["an ADMIN user", "product NUDELN-KARTON"],
    });
    expect(message).toContain("localhost:5123/nudel is not seeded");
    expect(message).toContain("an ADMIN user, product NUDELN-KARTON");
    expect(message).toContain("pnpm db:seed");
    expectActionable(message);

    expect(seedDataMissingMessage({ database: null, missing: ["the Settings row"] })).toContain(
      "this database is not seeded",
    );
  });

  it("names the missing demo reason", () => {
    const message = demoSeedMissingMessage({
      database: "localhost:5123/nudel",
      reason: "the depot pin is not confirmed",
    });
    expect(message).toContain("the depot pin is not confirmed in localhost:5123/nudel");
    expect(message).toContain("pnpm db:seed --demo --no-photos");
    expectActionable(message);
  });

  it("names unapplied migrations and shortens long lists", () => {
    const short = migrationDriftMessage({
      database: "localhost:5123/nudel",
      migrations: ["20261030090000_customer_abbreviation"],
    });
    expect(short).toContain("has not applied 1 migration");
    expect(short).toContain("20261030090000_customer_abbreviation");
    expect(short).toContain("pnpm db:migrate");

    const long = migrationDriftMessage({
      database: null,
      migrations: ["a1", "b2", "c3", "d4", "e5", "f6", "g7"],
    });
    expect(long).toContain("has not applied 7 migrations");
    expect(long).toContain("(2 more)");
  });

  it("tells the operator to set DATABASE_URL when the spec cannot reach any database", () => {
    const message = databaseUrlMissingMessage();
    expect(message).toContain("DATABASE_URL is not set");
    expectActionable(message);
  });
});
