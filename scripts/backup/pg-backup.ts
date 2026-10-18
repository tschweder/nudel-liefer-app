/**
 * Weekly logical backup (NUD-094): `pnpm backup:db`. Reads BACKUP_* from the environment (the
 * GitHub Action passes them from encrypted secrets, docs/runbook.md), dumps the database with
 * pg_dump, uploads the dump to the backup bucket and prunes backups older than 8 weeks.
 * Never prints connection strings or keys. Exit code 1 on any problem.
 */
import { appendFileSync } from "node:fs";

import { readBackupConfig, redactSecrets } from "../lib/backup";
import { runBackup } from "./core";
import { createS3BackupStore } from "./store";

async function main() {
  const parsed = readBackupConfig(process.env);
  if (!parsed.ok) {
    console.error(
      `backup configuration problem:\n${parsed.errors.map((e) => `  - ${e}`).join("\n")}`,
    );
    process.exit(1);
  }
  const { config } = parsed;
  const summary = await runBackup(config, {
    store: createS3BackupStore(config.s3),
    log: (line) => console.log(`[backup] ${line}`),
  });
  console.log(
    `[backup] done: ${summary.key} (${summary.bytes} bytes), ${summary.remaining} backups kept`,
  );
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Database backup\n\n- file: \`${summary.key}\`\n- size: ${summary.bytes} bytes\n- sha256: \`${summary.sha256}\`\n- tables with data: ${summary.dataTables}\n- backups kept: ${summary.remaining}, pruned: ${summary.pruned.length}\n`,
    );
  }
  // For the verify job of the workflow.
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `key=${summary.key}\n`);
}

main().catch((error: unknown) => {
  const secrets = [
    process.env.BACKUP_DATABASE_URL,
    process.env.BACKUP_S3_SECRET_ACCESS_KEY,
    process.env.BACKUP_S3_ACCESS_KEY_ID,
  ];
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[backup] FAILED: ${redactSecrets(message, secrets)}`);
  process.exit(1);
});
