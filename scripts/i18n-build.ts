import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { buildHant, GENERATED_LOCALES, type MessageTree } from "./lib/i18n";

const dir = path.join(process.cwd(), "messages");

function read(file: string): MessageTree {
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as MessageTree) : {};
}

const hans = read(path.join(dir, "zh-Hans.json"));
for (const locale of GENERATED_LOCALES) {
  const overrides = read(path.join(dir, "overrides", `${locale}.json`));
  const out = buildHant(locale, hans, overrides);
  writeFileSync(path.join(dir, `${locale}.json`), `${JSON.stringify(out, null, 2)}\n`);
  console.log(`i18n:build wrote messages/${locale}.json`);
}
