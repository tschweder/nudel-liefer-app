import { readFileSync } from "node:fs";
import path from "node:path";

import { importReview } from "./lib/i18n-review";

// Usage: pnpm i18n:import <file.csv> [--dry-run] [--force]
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("usage: pnpm i18n:import <file.csv> [--dry-run] [--force]");
  process.exit(1);
}

const result = importReview(
  path.join(process.cwd(), "messages"),
  readFileSync(path.resolve(file), "utf8"),
  { dryRun: args.includes("--dry-run"), force: args.includes("--force") },
);

if (!result.ok) {
  console.error(result.errors.map((e) => `  - ${e}`).join("\n"));
  console.error(`i18n:import failed with ${result.errors.length} problem(s); nothing was written`);
  process.exit(1);
}
for (const c of result.changes) {
  console.log(`${c.file}: ${c.key}: ${JSON.stringify(c.from)} -> ${JSON.stringify(c.to)}`);
}
console.log(
  `i18n:import ${result.written ? "applied" : "would apply"} ${result.changes.length} change(s); ` +
    `${result.comments} reviewer comment(s) in the file (comments are not stored; keep the CSV)`,
);
if (result.written)
  console.log("zh-Hant-HK.json / zh-Hant-TW.json regenerated; run `pnpm i18n:check`");
