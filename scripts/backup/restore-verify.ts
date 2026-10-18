/**
 * Test restore (NUD-094): `pnpm backup:verify [--key <object key>] [--file <local dump>]`.
 * Restores a backup (default: the newest in the backup bucket, or a local file) into an EMPTY
 * scratch database and checks the data. Target: RESTORE_DATABASE_URL (never production: it
 * refuses BACKUP_DATABASE_URL, DATABASE_URL and a non-empty database). See docs/runbook.md.
 */
import { readBackupConfig, redactSecrets } from "../lib/backup";
import { runRestoreVerify } from "./core";
import { createS3BackupStore } from "./store";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const targetUrl = process.env.RESTORE_DATABASE_URL?.trim();
  if (!targetUrl) {
    console.error("RESTORE_DATABASE_URL is not set (an empty scratch database)");
    process.exit(1);
  }
  const file = arg("--file");
  let store;
  let prefix: string | undefined;
  if (!file) {
    const parsed = readBackupConfig({
      BACKUP_DATABASE_URL: "postgresql://unused/unused",
      ...process.env,
    });
    if (!parsed.ok) {
      console.error(
        `backup configuration problem:\n${parsed.errors.map((e) => `  - ${e}`).join("\n")}`,
      );
      process.exit(1);
    }
    store = createS3BackupStore(parsed.config.s3);
    prefix = parsed.config.prefix;
  }
  const summary = await runRestoreVerify({
    targetUrl,
    file,
    store,
    prefix,
    key: arg("--key"),
    protectedUrls: [
      process.env.BACKUP_DATABASE_URL,
      process.env.DATABASE_URL,
      process.env.DATABASE_URL_UNPOOLED,
    ],
    log: (line) => console.log(`[verify] ${line}`),
  });
  console.log(
    `[verify] OK: ${summary.key ?? "local file"} restored; ${summary.tables} tables, ${summary.migrations} migrations, ${summary.admins} active admin(s)`,
  );
  console.log(
    Object.entries(summary.rowCounts)
      .map(([table, n]) => `  ${table}: ${n}`)
      .join("\n"),
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    `[verify] FAILED: ${redactSecrets(message, [process.env.RESTORE_DATABASE_URL, process.env.BACKUP_S3_SECRET_ACCESS_KEY])}`,
  );
  process.exit(1);
});
