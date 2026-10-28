import "dotenv/config";

import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { createPrismaClient } from "../../src/server/db";
import {
  type ImportEntry,
  importParkingSpots,
  type LedgerEntry,
  type PreparedPhoto,
} from "../../src/server/parking-import";
import { getStorage, readS3Config } from "../../src/server/storage";
import { uploadWithPresignedUrl } from "../../src/server/storage/upload";

/**
 * Phase 4 of the parking-spot import: write the reviewed parking pins into the database.
 *
 * Input is the *reviewed* decision list `.parking-import/review.json`, which
 * `build-report.py` derives from `results/*.json` and from the deterministic photo assignment.
 * To correct a pin, edit its `results/<pin>.json`, re-run `build-report.py`, and run this again.
 *
 *   pnpm parking:import                        # dry run: prints what would happen, writes nothing
 *   pnpm parking:import -- --apply             # the real write (asks for the DB to be the target)
 *
 * Dry run is the default on purpose: this touches production. `--apply` refuses to run when the
 * review is older than the newest result file, when no object storage is configured, or when the
 * decision list contains a pin that still needs a human (`action: review`; `--skip-pending`
 * imports the resolved pins and consciously leaves those).
 *
 * Usage:
 *   npx tsx scripts/parking-import/import-parking.ts [--apply] [--skip-pending] [--only u01,u07]
 *        [--label "..."] [--actor admin@example.com] [--no-photos] [--work .parking-import]
 */

const WORK_DEFAULT = path.resolve(process.cwd(), ".parking-import");
const LEDGER_FILE = "import-ledger.json";

type ReviewFile = {
  generatedAt: string;
  counts: Record<string, number>;
  entries: Array<
    ImportEntry & {
      status: string;
      addressGroupKey: string | null;
      distanceM: number | null;
      confidence: number | null;
    }
  >;
};
type UploadsFile = { uploads: Record<string, PreparedPhoto & { unitId: string }> };

function flagValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf-8")) as T;
  } catch {
    return null;
  }
}

function pad(value: string, width: number): string {
  return value.length >= width ? value.slice(0, width) : value.padEnd(width);
}

/**
 * Which database this run talks to. `PARKING_IMPORT_DATABASE_URL` wins, so a dry run can be aimed
 * at production (for example through an SSH tunnel) without touching the local `.env`; `--apply`
 * otherwise uses `DATABASE_URL`, which is the normal target. The label is printed, the password
 * never is.
 */
function resolveConnection(): { url: string; label: string } {
  const from = process.env.PARKING_IMPORT_DATABASE_URL
    ? "PARKING_IMPORT_DATABASE_URL"
    : "DATABASE_URL";
  const url = process.env.PARKING_IMPORT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("Neither PARKING_IMPORT_DATABASE_URL nor DATABASE_URL is set");
  try {
    const parsed = new URL(url);
    return { url, label: `${from} -> ${parsed.host}${parsed.pathname}` };
  } catch {
    return { url, label: `${from} -> (unparsable URL)` };
  }
}

async function main() {
  const apply = process.argv.includes("--apply");
  const skipPending = process.argv.includes("--skip-pending");
  const withPhotos = !process.argv.includes("--no-photos");
  const work = path.resolve(flagValue("--work") ?? WORK_DEFAULT);
  const label = flagValue("--label") ?? "Imported 2026-10";
  const actorEmail = flagValue("--actor");
  const only = (flagValue("--only") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const review = await readJson<ReviewFile>(path.join(work, "review.json"));
  if (!review) {
    console.error(
      `review.json not found in ${work} - run \`python scripts/parking-import/build-report.py\` first.`,
    );
    process.exitCode = 1;
    return;
  }
  const uploads = withPhotos ? await readJson<UploadsFile>(path.join(work, "uploads.json")) : null;
  if (withPhotos && !uploads) {
    console.error(
      `uploads.json not found in ${work} - run \`python scripts/parking-import/prepare-uploads.py\` first (or pass --no-photos).`,
    );
    process.exitCode = 1;
    return;
  }

  const entries = only.length
    ? review.entries.filter((entry) => only.includes(entry.unitId))
    : review.entries;

  // A stale decision list is the one mistake this script cannot detect afterwards: it would
  // import yesterday's judgement after somebody corrected a result file. Refuse on --apply.
  const reviewStat = await stat(path.join(work, "review.json"));
  let newestResultMs = 0;
  for (const entry of entries) {
    try {
      const resultStat = await stat(path.join(work, "results", `${entry.unitId}.json`));
      newestResultMs = Math.max(newestResultMs, resultStat.mtimeMs);
    } catch {
      // A missing result file is reported through the entry's `action` below.
    }
  }
  const stale = newestResultMs > reviewStat.mtimeMs + 1000;
  if (stale) {
    const message =
      "review.json is older than at least one results/*.json - the report does not reflect the " +
      "latest judgements. Re-run: python scripts/parking-import/build-report.py";
    if (apply) {
      console.error(`refusing to --apply: ${message}`);
      process.exitCode = 1;
      return;
    }
    console.warn(`warning: ${message}`);
  }

  const pending = entries.filter((entry) => entry.action === "review");
  if (apply && pending.length > 0 && !skipPending) {
    console.error(
      `${pending.length} pin(s) still need a human decision (action: review): ` +
        `${pending.map((entry) => entry.unitId).join(", ")}.\n` +
        "Resolve them in .parking-import/REPORT.html, edit the matching results/<pin>.json and " +
        "re-run build-report.py; or pass --skip-pending to import the resolved pins now and " +
        "leave these untouched.",
    );
    process.exitCode = 1;
    return;
  }
  if (pending.length > 0) {
    console.log(
      `note:      skipping ${pending.length} pin(s) that still need a decision ` +
        `(${pending.map((entry) => entry.unitId).join(", ")})`,
    );
  }

  if (apply && !readS3Config(process.env)) {
    console.error(
      "Object storage is not configured (S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY).\n" +
        "Refusing to --apply: the photos would be written to an in-memory Fake and lost.",
    );
    process.exitCode = 1;
    return;
  }

  const target = resolveConnection();
  const prisma = createPrismaClient(target.url);
  try {
    const admin = actorEmail
      ? await prisma.user.findFirst({ where: { email: actorEmail, role: "ADMIN" } })
      : await prisma.user.findFirst({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" } });
    if (!admin) {
      console.error(
        actorEmail
          ? `No ADMIN user with email ${actorEmail}.`
          : "No ADMIN user found - run the seed first.",
      );
      process.exitCode = 1;
      return;
    }

    const photoMap = new Map<string, PreparedPhoto>();
    for (const [unitId, photo] of Object.entries(uploads?.uploads ?? {})) {
      if (only.length && !only.includes(unitId)) continue;
      if (entries.some((entry) => entry.unitId === unitId && entry.action === "create")) {
        photoMap.set(unitId, photo);
      }
    }

    const ledger = ((await readJson<{ entries: LedgerEntry[] }>(path.join(work, LEDGER_FILE)))
      ?.entries ?? []) as LedgerEntry[];

    console.log(`mode:      ${apply ? "APPLY (writing)" : "DRY RUN (nothing is written)"}`);
    console.log(`database:  ${target.label}`);
    console.log(
      `storage:   ${readS3Config(process.env) ? "S3/MinIO/R2 (configured)" : "in-memory Fake"}`,
    );
    console.log(`actor:     ${admin.displayName} <${admin.email ?? "no email"}> (${admin.id})`);
    console.log(`label:     ${label}`);
    console.log(`work dir:  ${work}`);
    console.log(
      `pins:      ${entries.length} selected, ${entries.filter((e) => e.action === "create").length} to create, ` +
        `${entries.filter((e) => e.action === "exists").length} already present, ${pending.length} pending review`,
    );
    console.log(`photos:    ${photoMap.size} prepared${withPhotos ? "" : " (--no-photos)"}`);
    if (apply && ledger.length > 0) {
      console.log(`ledger:    ${ledger.length} entries from a previous run`);
    }
    console.log("");

    const storage = getStorage();
    const summary = await importParkingSpots(prisma, storage, {
      actorId: admin.id,
      entries,
      photos: photoMap,
      readPhoto: (photo) => readFile(path.resolve(process.cwd(), photo.file)),
      uploadPhoto: async ({ key, bytes, contentType }) => {
        await uploadWithPresignedUrl(storage, key, bytes, contentType);
      },
      ledger,
      label,
      apply,
    });

    const header = [
      pad("pin", 5),
      pad("customer", 26),
      pad("nr.", 7),
      pad("spot", 12),
      pad("photo", 14),
      "note",
    ].join(" ");
    console.log(header);
    console.log("-".repeat(header.length));
    for (const row of summary.rows) {
      console.log(
        [
          pad(row.unitId, 5),
          pad(row.customerName ?? "?", 26),
          pad(row.customerNumber ?? "?", 7),
          pad(row.spotOutcome, 12),
          pad(row.photoOutcome ?? "-", 14),
          row.notes.join("; "),
        ].join(" "),
      );
    }
    console.log("");
    console.log(
      `spots: ${summary.spotsCreated} ${apply ? "created" : "to create"}, ` +
        `${summary.spotsExisting} already there`,
    );
    console.log(
      `photos: ${summary.photosAdded} ${apply ? "added" : "to add"}, ${summary.photosKept} kept as they are`,
    );
    console.log(`pins skipped (not action=create): ${summary.entriesSkipped}`);
    if (summary.failures > 0) console.log(`FAILURES: ${summary.failures} (see the table)`);

    if (apply) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      await writeFile(
        path.join(work, LEDGER_FILE),
        JSON.stringify({ updatedAt: new Date().toISOString(), entries: summary.ledger }, null, 2),
        "utf-8",
      );
      await writeFile(
        path.join(work, `import-${stamp}.json`),
        JSON.stringify(summary, null, 2),
        "utf-8",
      );
      console.log(`\nledger:    ${path.join(work, LEDGER_FILE)}`);
      console.log(`result:    ${path.join(work, `import-${stamp}.json`)}`);
    } else {
      console.log("\nNothing was written. Re-run with --apply to write.");
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main();
