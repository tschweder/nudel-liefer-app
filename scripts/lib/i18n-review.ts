import {
  checkMessages,
  expectedKeys,
  flatten,
  MESSAGE_LOCALES,
  type MessageLocale,
  type MessageTree,
  placeholderNames,
} from "./i18n";
import { buildGenerated, localeFile, readSources, writeTree } from "./i18n-files";
import { routeHint } from "./i18n-routes";

/** Languages a reviewer can correct (German is the source text and is edited in the repository). */
export const REVIEW_LOCALES = [
  "en",
  "sr-Latn",
  "cs",
  "zh-Hans",
] as const satisfies readonly MessageLocale[];
export type ReviewLocale = (typeof REVIEW_LOCALES)[number];

export const REVIEW_COLUMNS = [
  "key",
  "de",
  "en",
  "sr-Latn",
  "cs",
  "zh-Hans",
  "route_hint",
  "reviewer_comment",
  "corrected_en",
  "corrected_sr-Latn",
  "corrected_cs",
  "corrected_zh-Hans",
] as const;

// ---------------------------------------------------------------------------------------------
// CSV (RFC 4180 quoting, UTF-8 BOM so Excel detects the encoding)
// ---------------------------------------------------------------------------------------------

const BOM = "﻿";

function quote(field: string, delimiter: string): string {
  return /["\r\n]/.test(field) || field.includes(delimiter)
    ? `"${field.replace(/"/g, '""')}"`
    : field;
}

export function toCsv(rows: string[][], delimiter = ","): string {
  return (
    BOM +
    rows.map((row) => row.map((f) => quote(f, delimiter)).join(delimiter)).join("\r\n") +
    "\r\n"
  );
}

/** German Excel saves ";" separated files, so the delimiter is detected from the header line. */
function detectDelimiter(text: string): string {
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  let inQuotes = false;
  for (const ch of text) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === "\n" || ch === "\r")) break;
    else if (!inQuotes && ch in counts) counts[ch]++;
  }
  return [",", ";", "\t"].reduce((best, d) => (counts[d] > counts[best] ? d : best), ",");
}

export function parseCsv(input: string): string[][] {
  const text = input.startsWith(BOM) ? input.slice(1) : input;
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else field += ch;
  }
  if (inQuotes) throw new Error("CSV: unterminated quoted field");
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // drop completely empty lines (e.g. trailing rows added by spreadsheets)
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

// ---------------------------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------------------------

/** All five locales as flat key -> text maps. */
function currentTexts(dir: string) {
  const sources = readSources(dir);
  return Object.fromEntries(MESSAGE_LOCALES.map((l) => [l, flatten(sources[l])])) as Record<
    MessageLocale,
    Record<string, string>
  >;
}

export function exportReview(
  dir: string,
  delimiter = ",",
): { csv: string; rows: number; withoutHint: string[] } {
  const texts = currentTexts(dir);
  const keys = Object.keys(texts.de);
  const withoutHint: string[] = [];
  const rows: string[][] = [[...REVIEW_COLUMNS]];
  for (const key of keys) {
    const hint = routeHint(key);
    if (hint === "") withoutHint.push(key);
    rows.push([
      key,
      texts.de[key] ?? "",
      texts.en[key] ?? "",
      texts["sr-Latn"][key] ?? "",
      texts.cs[key] ?? "",
      texts["zh-Hans"][key] ?? "",
      hint,
      "",
      "",
      "",
      "",
      "",
    ]);
  }
  return { csv: toCsv(rows, delimiter), rows: keys.length, withoutHint };
}

// ---------------------------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------------------------

export type ReviewChange = { file: string; key: string; from: string | null; to: string | null };

export type ImportResult = {
  ok: boolean;
  errors: string[];
  /** Edits to the message files. Empty on failure. */
  changes: ReviewChange[];
  /** Number of reviewer comments in the file (informational, never written to disk). */
  comments: number;
  written: boolean;
};

const norm = (s: string) => s.replace(/\r\n?/g, "\n");

function setPath(tree: MessageTree, key: string, value: string): void {
  const parts = key.split(".");
  let node = tree;
  for (const part of parts.slice(0, -1)) {
    const next = node[part];
    if (typeof next === "object" && next !== null) node = next;
    else node = node[part] = {};
  }
  node[parts[parts.length - 1]!] = value;
}

const clone = (tree: MessageTree): MessageTree => JSON.parse(JSON.stringify(tree)) as MessageTree;

/**
 * Applies reviewer corrections from a CSV to `<dir>/<locale>.json` and refreshes the fatal-error
 * texts. All-or-nothing: on any error nothing is written.
 */
export function importReview(
  dir: string,
  csvText: string,
  options: { dryRun?: boolean; force?: boolean } = {},
): ImportResult {
  const errors: string[] = [];
  const fail = (): ImportResult => ({
    ok: false,
    errors,
    changes: [],
    comments: 0,
    written: false,
  });

  let table: string[][];
  try {
    table = parseCsv(csvText);
  } catch (error) {
    errors.push((error as Error).message);
    return fail();
  }
  const header = (table[0] ?? []).map((h) => h.trim());
  const col = (name: string) => header.indexOf(name);
  if (col("key") < 0) {
    errors.push(
      'missing "key" column in the header line (is this an export of `pnpm i18n:export`?)',
    );
    return fail();
  }
  const correctedCols = REVIEW_LOCALES.map((l) => [l, col(`corrected_${l}`)] as const);
  if (correctedCols.every(([, i]) => i < 0)) {
    errors.push('no "corrected_<locale>" columns found in the header line');
    return fail();
  }

  const sources = readSources(dir);
  const before = currentTexts(dir);
  const germanKeys = Object.keys(before.de);
  const known = new Set(germanKeys);
  const allowed = Object.fromEntries(
    MESSAGE_LOCALES.map((l) => [l, new Set(expectedKeys(l, germanKeys))]),
  ) as Record<MessageLocale, Set<string>>;

  type Edit = { locale: ReviewLocale; key: string; value: string; row: number };
  const edits: Edit[] = [];
  const seen = new Set<string>();
  let comments = 0;
  const commentCol = col("reviewer_comment");

  table.slice(1).forEach((cells, index) => {
    const row = index + 2; // 1-based line in the spreadsheet, header = 1
    const key = (cells[col("key")] ?? "").trim();
    if (key === "") {
      errors.push(`row ${row}: empty key`);
      return;
    }
    if (!known.has(key)) {
      errors.push(`row ${row}: unknown key "${key}"`);
      return;
    }
    if (seen.has(key)) {
      errors.push(`row ${row}: duplicate key "${key}"`);
      return;
    }
    seen.add(key);
    if (commentCol >= 0 && (cells[commentCol] ?? "").trim() !== "") comments++;
    for (const [locale, i] of correctedCols) {
      if (i < 0) continue;
      const value = norm(cells[i] ?? "").trim();
      if (value === "") continue;
      if (!allowed[locale].has(key)) {
        errors.push(
          `row ${row}: "${key}" is not used in ${locale} (office screens are de/en/zh-Hans only)`,
        );
        continue;
      }
      const exportedCell = col(locale);
      if (!options.force && exportedCell >= 0 && cells[exportedCell] !== undefined) {
        if (norm(cells[exportedCell]) !== norm(before[locale][key] ?? "")) {
          errors.push(
            `row ${row}: "${key}" (${locale}) changed in the repository since the export; re-export or use --force`,
          );
          continue;
        }
      }
      if (value === (before[locale][key] ?? "")) continue; // identical to current text: no edit
      edits.push({ locale, key, value, row });
    }
  });

  // Syntax and placeholder validation of every new text.
  for (const edit of edits) {
    try {
      const names = placeholderNames(edit.value, edit.locale);
      const expected = placeholderNames(before.de[edit.key] ?? "", "de");
      const missing = [...expected].filter((n) => !names.has(n));
      const extra = [...names].filter((n) => !expected.has(n));
      if (missing.length > 0 || extra.length > 0) {
        errors.push(
          `row ${edit.row}: "${edit.key}" (${edit.locale}) placeholders differ from German` +
            ` (missing: ${missing.join(", ") || "-"}; unexpected: ${extra.join(", ") || "-"})`,
        );
      }
    } catch (error) {
      errors.push(
        `row ${edit.row}: "${edit.key}" (${edit.locale}) invalid ICU syntax: ${(error as Error).message}`,
      );
    }
  }
  if (errors.length > 0) return fail();

  // Apply in memory.
  const trees = Object.fromEntries(MESSAGE_LOCALES.map((l) => [l, clone(sources[l])])) as Record<
    MessageLocale,
    MessageTree
  >;
  for (const edit of edits) setPath(trees[edit.locale], edit.key, edit.value);

  const changes: ReviewChange[] = [];
  for (const locale of REVIEW_LOCALES) {
    const a = flatten(sources[locale]);
    const b = flatten(trees[locale]);
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (a[key] !== b[key]) {
        changes.push({ file: `${locale}.json`, key, from: a[key] ?? null, to: b[key] ?? null });
      }
    }
  }

  // Validate the complete result exactly like `pnpm i18n:check` would.
  const problems = checkMessages(trees);
  if (problems.length > 0) {
    errors.push(...problems.map((p) => `result check: ${p}`));
    return fail();
  }

  if (options.dryRun || changes.length === 0) {
    return { ok: true, errors, changes, comments, written: false };
  }

  for (const locale of REVIEW_LOCALES) {
    if (changes.some((c) => c.file === `${locale}.json`)) {
      writeTree(localeFile(dir, locale), trees[locale]);
    }
  }
  buildGenerated(dir);
  return { ok: true, errors, changes, comments, written: true };
}
