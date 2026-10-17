import path from "node:path";

import { IntlMessageFormat } from "intl-messageformat";

import { buildHant, checkMessages, flatten, GENERATED_LOCALES, type MessageTree } from "./i18n";
import {
  buildGenerated,
  type GeneratedLocale,
  overridePath,
  readSources,
  writeTree,
} from "./i18n-files";
import { routeHint } from "./i18n-routes";

export const REVIEW_LOCALES = ["zh-Hans", ...GENERATED_LOCALES] as const;
export type ReviewLocale = (typeof REVIEW_LOCALES)[number];

export const REVIEW_COLUMNS = [
  "key",
  "de",
  "zh-Hans",
  "zh-Hant-HK",
  "zh-Hant-TW",
  "route_hint",
  "reviewer_comment",
  "corrected_zh-Hans",
  "corrected_zh-Hant-HK",
  "corrected_zh-Hant-TW",
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
// ICU helpers
// ---------------------------------------------------------------------------------------------

type IcuNode = {
  type: number;
  value?: string;
  children?: IcuNode[];
  options?: Record<string, { value: IcuNode[] }>;
};

/** Names of all arguments / tags used in an ICU message (throws on invalid syntax). */
export function placeholderNames(message: string, locale: string): Set<string> {
  const out = new Set<string>();
  const walk = (nodes: IcuNode[]) => {
    for (const node of nodes) {
      // 1 argument, 2 number, 3 date, 4 time, 5 select, 6 plural, 8 tag
      if ([1, 2, 3, 4, 5, 6, 8].includes(node.type) && node.value) out.add(node.value);
      if (node.children) walk(node.children);
      if (node.options) for (const option of Object.values(node.options)) walk(option.value);
    }
  };
  walk(new IntlMessageFormat(message, locale).getAst() as unknown as IcuNode[]);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------------------------

/** All four locales as flat key -> text maps, Hant computed fresh from zh-Hans + overrides. */
function currentTexts(dir: string) {
  const { de, hans, overrides } = readSources(dir);
  return {
    de: flatten(de),
    "zh-Hans": flatten(hans),
    "zh-Hant-HK": flatten(buildHant("zh-Hant-HK", hans, overrides["zh-Hant-HK"])),
    "zh-Hant-TW": flatten(buildHant("zh-Hant-TW", hans, overrides["zh-Hant-TW"])),
  };
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
      texts["zh-Hans"][key] ?? "",
      texts["zh-Hant-HK"][key] ?? "",
      texts["zh-Hant-TW"][key] ?? "",
      hint,
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
  /** Edits to the hand-maintained files (zh-Hans.json, overrides/*). Empty on failure. */
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
  node[parts[parts.length - 1]] = value;
}

function deletePath(tree: MessageTree, key: string): void {
  const parts = key.split(".");
  const walk = (node: MessageTree, depth: number): void => {
    const part = parts[depth];
    const child = node[part];
    if (depth === parts.length - 1) delete node[part];
    else if (typeof child === "object" && child !== null) {
      walk(child, depth + 1);
      if (Object.keys(child).length === 0) delete node[part];
    }
  };
  walk(tree, 0);
}

function sortTree(tree: MessageTree): MessageTree {
  const out: MessageTree = {};
  for (const key of Object.keys(tree).sort()) {
    const value = tree[key];
    out[key] = typeof value === "string" ? value : sortTree(value);
  }
  return out;
}

const clone = (tree: MessageTree): MessageTree => JSON.parse(JSON.stringify(tree)) as MessageTree;

/**
 * Applies reviewer corrections from a CSV to `<dir>/zh-Hans.json` / `<dir>/overrides/*.json`
 * and regenerates the Hant files. All-or-nothing: on any error nothing is written.
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
  const known = new Set([...Object.keys(before.de), ...Object.keys(before["zh-Hans"])]);
  const deKeys = before.de;

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
      const expected = placeholderNames(
        deKeys[edit.key] ?? before["zh-Hans"][edit.key] ?? "",
        "de",
      );
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

  // Apply in memory. zh-Hans first so Hant corrections are compared against the new conversion.
  const hans = clone(sources.hans);
  const overrides: Record<GeneratedLocale, MessageTree> = {
    "zh-Hant-HK": clone(sources.overrides["zh-Hant-HK"]),
    "zh-Hant-TW": clone(sources.overrides["zh-Hant-TW"]),
  };
  for (const edit of edits.filter((e) => e.locale === "zh-Hans"))
    setPath(hans, edit.key, edit.value);
  for (const locale of GENERATED_LOCALES) {
    const plain = flatten(buildHant(locale, hans, {}));
    const currentOverrides = flatten(overrides[locale]);
    for (const edit of edits.filter((e) => e.locale === locale)) {
      if (edit.value === plain[edit.key]) {
        // the automatic conversion already yields this text: a stored override is redundant
        if (edit.key in currentOverrides) deletePath(overrides[locale], edit.key);
      } else setPath(overrides[locale], edit.key, edit.value);
    }
  }

  // Report what changed in the hand-edited files.
  const changes: ReviewChange[] = [];
  const diff = (file: string, oldTree: MessageTree, newTree: MessageTree) => {
    const a = flatten(oldTree);
    const b = flatten(newTree);
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (a[key] !== b[key]) changes.push({ file, key, from: a[key] ?? null, to: b[key] ?? null });
    }
  };
  diff("zh-Hans.json", sources.hans, hans);
  for (const locale of GENERATED_LOCALES) {
    diff(`overrides/${locale}.json`, sources.overrides[locale], overrides[locale]);
  }

  // Validate the complete result exactly like `pnpm i18n:check` would after the build.
  const tw = buildHant("zh-Hant-TW", hans, overrides["zh-Hant-TW"]);
  const hk = buildHant("zh-Hant-HK", hans, overrides["zh-Hant-HK"]);
  const problems = checkMessages({
    de: sources.de,
    "zh-Hans": hans,
    "zh-Hant-HK": hk,
    "zh-Hant-TW": tw,
    overrides,
  });
  if (problems.length > 0) {
    errors.push(...problems.map((p) => `result check: ${p}`));
    return fail();
  }

  if (options.dryRun || changes.length === 0) {
    return { ok: true, errors, changes, comments, written: false };
  }

  if (changes.some((c) => c.file === "zh-Hans.json"))
    writeTree(path.join(dir, "zh-Hans.json"), hans);
  for (const locale of GENERATED_LOCALES) {
    if (changes.some((c) => c.file === `overrides/${locale}.json`)) {
      writeTree(overridePath(dir, locale), sortTree(overrides[locale]));
    }
  }
  buildGenerated(dir);
  return { ok: true, errors, changes, comments, written: true };
}
