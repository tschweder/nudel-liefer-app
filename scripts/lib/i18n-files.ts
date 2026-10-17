import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { buildHant, GENERATED_LOCALES, type MessageTree } from "./i18n";

export type GeneratedLocale = (typeof GENERATED_LOCALES)[number];

export function readTree(file: string): MessageTree {
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as MessageTree) : {};
}

export function writeTree(file: string, tree: MessageTree): void {
  writeFileSync(file, `${JSON.stringify(tree, null, 2)}\n`);
}

export function overridePath(dir: string, locale: GeneratedLocale): string {
  return path.join(dir, "overrides", `${locale}.json`);
}

/** The hand-maintained and override trees as stored on disk. */
export function readSources(dir: string) {
  return {
    de: readTree(path.join(dir, "de.json")),
    hans: readTree(path.join(dir, "zh-Hans.json")),
    overrides: {
      "zh-Hant-HK": readTree(overridePath(dir, "zh-Hant-HK")),
      "zh-Hant-TW": readTree(overridePath(dir, "zh-Hant-TW")),
    } as Record<GeneratedLocale, MessageTree>,
  };
}

/** Regenerates `zh-Hant-*.json` from `zh-Hans.json` + overrides (what `pnpm i18n:build` does). */
export function buildGenerated(dir: string, log: (line: string) => void = () => {}): void {
  const { hans, overrides } = readSources(dir);
  for (const locale of GENERATED_LOCALES) {
    writeTree(path.join(dir, `${locale}.json`), buildHant(locale, hans, overrides[locale]));
    log(`i18n:build wrote messages/${locale}.json`);
  }
}
