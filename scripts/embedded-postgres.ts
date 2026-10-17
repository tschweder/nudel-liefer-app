/**
 * Starts a throwaway local PostgreSQL (no Docker needed) for environments where
 * `docker compose up` is not available. Usage: `pnpm db:embedded` (Ctrl+C to stop).
 * Data lives in ./.embedded-postgres (git-ignored). Prints a DATABASE_URL to use.
 */
import { existsSync } from "node:fs";

import EmbeddedPostgres from "embedded-postgres";

const dataDir = process.env.EMBEDDED_PG_DIR ?? ".embedded-postgres";
const port = Number(process.env.EMBEDDED_PG_PORT ?? 5432);
const user = "postgres";
const password = "postgres";
const database = "nudel";

async function main() {
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user,
    password,
    port,
    persistent: true,
  });
  if (!existsSync(`${dataDir}/PG_VERSION`)) await pg.initialise();
  await pg.start();
  try {
    await pg.createDatabase(database);
  } catch {
    // database already exists
  }
  console.log(`DATABASE_URL=postgresql://${user}:${password}@localhost:${port}/${database}`);
  const stop = async () => {
    await pg.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
