import { writeFileSync } from "node:fs";
import path from "node:path";

import { exportReview } from "./lib/i18n-review";

// Usage: pnpm i18n:export [--out <file>] [--delimiter ";"]
// Default output: ./i18n-review.csv (gitignored, never commit real review output).
const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const out = path.resolve(option("--out", "i18n-review.csv"));
const delimiter = option("--delimiter", ",");
if (![",", ";", "\t"].includes(delimiter)) {
  console.error('--delimiter must be ",", ";" or a tab');
  process.exit(1);
}

const { csv, rows, withoutHint } = exportReview(path.join(process.cwd(), "messages"), delimiter);
writeFileSync(out, csv);
console.log(`i18n:export wrote ${rows} rows to ${out}`);
if (withoutHint.length > 0) {
  console.warn(
    `warning: ${withoutHint.length} key(s) have no route hint, add a prefix to scripts/lib/i18n-routes.ts (first: ${withoutHint[0]})`,
  );
}
