import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { checkMessages, type MessageTree } from "./lib/i18n";

const dir = path.join(process.cwd(), "messages");

function read(file: string): MessageTree {
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as MessageTree) : {};
}

const errors = checkMessages({
  de: read(path.join(dir, "de.json")),
  "zh-Hans": read(path.join(dir, "zh-Hans.json")),
  "zh-Hant-HK": read(path.join(dir, "zh-Hant-HK.json")),
  "zh-Hant-TW": read(path.join(dir, "zh-Hant-TW.json")),
  overrides: {
    "zh-Hant-HK": read(path.join(dir, "overrides", "zh-Hant-HK.json")),
    "zh-Hant-TW": read(path.join(dir, "overrides", "zh-Hant-TW.json")),
  },
});

if (errors.length > 0) {
  console.error(errors.map((e) => `  - ${e}`).join("\n"));
  console.error(`i18n:check failed with ${errors.length} problem(s)`);
  process.exit(1);
}
console.log("i18n:check ok");
