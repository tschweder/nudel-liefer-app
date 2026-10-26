import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { checkMessages, type MessageTree } from "./lib/i18n";
import { buildFatalMessages, FATAL_MESSAGES_FILE, readSources } from "./lib/i18n-files";

const dir = path.join(process.cwd(), "messages");

function read(file: string): MessageTree {
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as MessageTree) : {};
}

const errors = checkMessages(readSources(dir));

// NUD-094: src/lib/fatal-messages.json is derived from the message files (global-error.tsx).
const fatalFile = path.join(dir, FATAL_MESSAGES_FILE);
if (
  JSON.stringify(read(fatalFile)) !== JSON.stringify(buildFatalMessages(dir)) ||
  Object.keys(read(fatalFile)).length === 0
) {
  errors.push("src/lib/fatal-messages.json is stale or missing, run `pnpm i18n:build`");
}

if (errors.length > 0) {
  console.error(errors.map((e) => `  - ${e}`).join("\n"));
  console.error(`i18n:check failed with ${errors.length} problem(s)`);
  process.exit(1);
}
console.log("i18n:check ok");
