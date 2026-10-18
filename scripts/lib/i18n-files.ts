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

/** Where the tiny text file for `global-error.tsx` lives (relative to the messages directory). */
export const FATAL_MESSAGES_FILE = path.join("..", "src", "lib", "fatal-messages.json");

/**
 * Texts of the last-resort error page (NUD-094, `errorPages.fatal`) for all four locales. The
 * root error page renders outside the locale layout, so it cannot use next-intl and must not
 * import the 50 KB message files; it imports this small file instead.
 */
export function buildFatalMessages(dir: string): Record<string, MessageTree> {
  const { de, hans, overrides } = readSources(dir);
  const pick = (tree: MessageTree) => {
    const errorPages = tree.errorPages as MessageTree | undefined;
    return (errorPages?.fatal ?? {}) as MessageTree;
  };
  return {
    de: pick(de),
    "zh-Hans": pick(hans),
    "zh-Hant-HK": pick(buildHant("zh-Hant-HK", hans, overrides["zh-Hant-HK"])),
    "zh-Hant-TW": pick(buildHant("zh-Hant-TW", hans, overrides["zh-Hant-TW"])),
  };
}

/** Regenerates `zh-Hant-*.json` from `zh-Hans.json` + overrides (what `pnpm i18n:build` does). */
export function buildGenerated(dir: string, log: (line: string) => void = () => {}): void {
  const { hans, overrides } = readSources(dir);
  for (const locale of GENERATED_LOCALES) {
    writeTree(path.join(dir, `${locale}.json`), buildHant(locale, hans, overrides[locale]));
    log(`i18n:build wrote messages/${locale}.json`);
  }
  // Only next to a real project (tests run this on a temporary copy of the messages directory).
  const fatalFile = path.join(dir, FATAL_MESSAGES_FILE);
  if (existsSync(path.dirname(fatalFile))) {
    writeTree(fatalFile, buildFatalMessages(dir));
    log("i18n:build wrote src/lib/fatal-messages.json");
  }
}
