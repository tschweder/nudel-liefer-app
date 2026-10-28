/**
 * Lifecycle of the dedicated end-to-end database (NUD-162): `pnpm e2e:db:reset`.
 *
 * Deletes everything in `E2E_DATABASE_URL`, applies every migration (and the base seed configured
 * in `prisma.config.ts`) and adds the demo data without photos, so `late-orders.spec.ts`,
 * `mvp-happy-path.spec.ts` and `tour-split.spec.ts` find a database with no tour for today, a
 * confirmed depot pin and the demo drivers. `playwright.config.ts` copies `E2E_DATABASE_URL` into
 * `DATABASE_URL`, so the app under test and the specs look at the same rows.
 *
 * It never touches the developer's database: the guards of `./lib/e2e-database` refuse an
 * `E2E_DATABASE_URL` that names the same host/port/database as `DATABASE_URL` (or any other
 * data-bearing variable), and nothing is dropped before that check passed. Operator guide:
 * docs/e2e-database.md.
 */
import "dotenv/config";

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  E2E_DATABASE_VAR,
  E2E_DB_DOC,
  E2E_DB_RESET_COMMAND,
  resolveE2eDatabase,
} from "./lib/e2e-database";

const USAGE = `Usage: ${E2E_DB_RESET_COMMAND}
  Drops everything in ${E2E_DATABASE_VAR}, applies all migrations, runs the base seed and adds the
  demo data without photos. Guide: ${E2E_DB_DOC}`;

function fail(lines: readonly string[]): never {
  for (const line of lines) console.error(`[e2e-db] ${line}`);
  process.exit(1);
}

function prismaCli(): string {
  const cli = join(process.cwd(), "node_modules", "prisma", "build", "index.js");
  if (!existsSync(cli)) {
    fail([
      `the Prisma CLI is missing at ${cli}.`,
      "Run `pnpm install` and start the command from the repository root.",
    ]);
  }
  return cli;
}

async function reset(url: string, identity: string): Promise<void> {
  // The child process must use the e2e database and nothing else. `prisma.config.ts` prefers
  // DATABASE_URL_UNPOOLED when it is set, and it loads `.env` itself (dotenv never overwrites an
  // existing variable), so an explicitly empty value is what keeps a Neon/production URL out.
  const childEnv = { ...process.env, DATABASE_URL: url, DATABASE_URL_UNPOOLED: "" };

  console.log(`[e2e-db] target: ${identity} (${E2E_DATABASE_VAR})`);
  console.log("[e2e-db] dropping all data, applying migrations and the base seed …");
  const migrate = spawnSync(process.execPath, [prismaCli(), "migrate", "reset", "--force"], {
    cwd: process.cwd(),
    env: childEnv,
    stdio: "inherit",
  });
  if (migrate.error) fail([`could not start the Prisma CLI: ${migrate.error.message}`]);
  if (migrate.status !== 0) {
    fail([
      `\`prisma migrate reset\` exited with ${migrate.status ?? migrate.signal}; the database may be empty.`,
      "Common causes: PostgreSQL is not running, the URL is wrong, or SEED_ADMIN_PASSWORD is missing (the base seed needs it).",
    ]);
  }

  // Same process environment for the Prisma client the seeds build below.
  process.env.DATABASE_URL = url;
  process.env.DATABASE_URL_UNPOOLED = "";
  const { seed } = await import("../prisma/seed");
  const { seedDemo } = await import("../src/server/demo-seed");
  const { createPrismaClient } = await import("../src/server/db");
  const prisma = createPrismaClient(url);
  try {
    // `migrate reset` runs the configured seed too; both seeds are idempotent, and running the
    // base seed here again keeps this script correct if a Prisma version stops doing that.
    console.log("[e2e-db] base seed (admin, settings, drivers, catalog products) …");
    await seed(prisma);
    console.log("[e2e-db] demo data without the photos …");
    const summary = await seedDemo(prisma, { photos: false });
    console.log(`[e2e-db] demo data: ${JSON.stringify(summary)}`);
  } finally {
    await prisma.$disconnect();
  }

  console.log(`[e2e-db] ready: ${identity} has no tour and no confirmed order for today.`);
  console.log(
    `[e2e-db] run the suite with ${E2E_DATABASE_VAR} still set, e.g. \`pnpm test:e2e <spec>\`.`,
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0] !== "reset") {
    console.error(USAGE);
    process.exit(args.length === 0 ? 0 : 1);
  }
  const resolution = resolveE2eDatabase(process.env);
  if (!resolution.ok) fail(resolution.errors);
  await reset(resolution.url, resolution.identity);
}

main().catch((error: unknown) => {
  fail([error instanceof Error ? error.message : String(error)]);
});
