import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { MESSAGE_LOCALES, type MessageLocale, type MessageTree } from "./i18n";

export function readTree(file: string): MessageTree {
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as MessageTree) : {};
}

export function writeTree(file: string, tree: MessageTree): void {
  writeFileSync(file, `${JSON.stringify(tree, null, 2)}\n`);
}

export const localeFile = (dir: string, locale: MessageLocale): string =>
  path.join(dir, `${locale}.json`);

/** The five message files as stored on disk. */
export function readSources(dir: string): Record<MessageLocale, MessageTree> {
  return Object.fromEntries(
    MESSAGE_LOCALES.map((l) => [l, readTree(localeFile(dir, l))]),
  ) as Record<MessageLocale, MessageTree>;
}

/** Where the tiny text file for `global-error.tsx` lives (relative to the messages directory). */
export const FATAL_MESSAGES_FILE = path.join("..", "src", "lib", "fatal-messages.json");

/**
 * Texts of the last-resort error page (NUD-094, `errorPages.fatal`) for all five locales. The
 * root error page renders outside the locale layout, so it cannot use next-intl and must not
 * import the big message files; it imports this small file instead.
 */
export function buildFatalMessages(dir: string): Record<string, MessageTree> {
  const sources = readSources(dir);
  return Object.fromEntries(
    MESSAGE_LOCALES.map((locale) => {
      const errorPages = sources[locale].errorPages as MessageTree | undefined;
      return [locale, (errorPages?.fatal ?? {}) as MessageTree];
    }),
  );
}

/** Regenerates `src/lib/fatal-messages.json` (what `pnpm i18n:build` does; the message files are hand-written). */
export function buildGenerated(dir: string, log: (line: string) => void = () => {}): void {
  // Only next to a real project (tests run this on a temporary copy of the messages directory).
  const fatalFile = path.join(dir, FATAL_MESSAGES_FILE);
  if (existsSync(path.dirname(fatalFile))) {
    writeTree(fatalFile, buildFatalMessages(dir));
    log("i18n:build wrote src/lib/fatal-messages.json");
  }
}
