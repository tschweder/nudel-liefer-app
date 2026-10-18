/**
 * Pure rules of the customer import (NUD-090): column mapping, cell cleaning, row validation and the
 * create / update / unchanged plan per row. No framework imports; the server (`src/server/
 * customer-import.ts`) loads the existing customers, calls `planImport` and writes the result.
 */
import { addressChanged } from "./customer";
import type { ParsedTable } from "./import-file";

export const IMPORT_FIELDS = [
  "customerNumber",
  "name",
  "street",
  "postalCode",
  "city",
  "country",
  "deliveryHoursInfo",
  "notes",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

export const REQUIRED_IMPORT_FIELDS: readonly ImportField[] = [
  "customerNumber",
  "name",
  "street",
  "postalCode",
  "city",
];

/** Same limits as the customer form (`customerInputSchema`). */
export const FIELD_MAX_LENGTH: Record<ImportField, number> = {
  customerNumber: 32,
  name: 160,
  street: 160,
  postalCode: 16,
  city: 100,
  country: 2,
  deliveryHoursInfo: 300,
  notes: 2000,
};

export const DEFAULT_COUNTRY = "AT";

/** Customers per geocoding request (the browser loops over batches so progress and cancel work). */
export const GEOCODE_BATCH_SIZE = 5;

/** Mapped raw cell texts of one file row. */
export type ImportRecord = Partial<Record<ImportField, string>>;
/** Field -> index of the file column that feeds it. */
export type ColumnMapping = Partial<Record<ImportField, number>>;

// ---------------------------------------------------------------------------------------------
// Column mapping

/** Lower-case, accent-folded, letters and digits only (ß -> ss), so "Straße", "STRASSE" and "Str." compare. */
export function normalizeHeader(header: string): string {
  return header
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replaceAll("ß", "ss")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

const SYNONYMS: Record<ImportField, string[]> = {
  customerNumber: [
    "kundennummer",
    "kundennr",
    "kdnr",
    "kdnummer",
    "kunde nr",
    "nummer",
    "nr",
    "customernumber",
    "customerno",
    "customerid",
    "clientnumber",
    "id",
    "客户编号",
    "客户号",
    "客户代码",
    "客戶編號",
    "編號",
    "编号",
  ],
  name: [
    "name",
    "kundenname",
    "firma",
    "firmenname",
    "bezeichnung",
    "kunde",
    "customer",
    "customername",
    "company",
    "客户名称",
    "客户名",
    "店名",
    "名称",
    "客戶名稱",
    "名稱",
  ],
  street: [
    "strasse",
    "strassehausnummer",
    "strasseundhausnummer",
    "adresse",
    "anschrift",
    "lieferadresse",
    "street",
    "address",
    "streetaddress",
    "地址",
    "街道",
  ],
  postalCode: [
    "plz",
    "postleitzahl",
    "zip",
    "zipcode",
    "postalcode",
    "postcode",
    "邮编",
    "郵遞區號",
  ],
  city: ["ort", "stadt", "city", "wohnort", "place", "城市", "市"],
  country: ["land", "country", "staat", "国家", "國家"],
  deliveryHoursInfo: [
    "lieferzeiten",
    "lieferzeit",
    "lieferhinweis",
    "oeffnungszeiten",
    "offnungszeiten",
    "deliveryhours",
    "deliverytime",
    "openinghours",
    "送货时间",
    "送貨時間",
    "营业时间",
  ],
  notes: [
    "hinweise",
    "hinweis",
    "notiz",
    "notizen",
    "bemerkung",
    "bemerkungen",
    "anmerkung",
    "fahrerhinweis",
    "fahrerhinweise",
    "kommentar",
    "notes",
    "note",
    "comment",
    "comments",
    "备注",
    "備註",
  ],
};

const SYNONYM_LOOKUP: Map<string, ImportField> = (() => {
  const map = new Map<string, ImportField>();
  for (const field of IMPORT_FIELDS) {
    for (const word of SYNONYMS[field]) map.set(normalizeHeader(word), field);
  }
  return map;
})();

/** What the browser remembers: field -> header text of the last import. */
export type RememberedMapping = Partial<Record<ImportField, string>>;

/**
 * Proposes a mapping for the header row: the remembered mapping first (matching header texts), then
 * well-known German / English / Chinese header names. A column feeds at most one field.
 */
export function suggestMapping(
  headers: readonly string[],
  remembered: RememberedMapping = {},
): ColumnMapping {
  const normalized = headers.map(normalizeHeader);
  const mapping: ColumnMapping = {};
  const used = new Set<number>();
  const assign = (field: ImportField, column: number) => {
    if (used.has(column) || mapping[field] !== undefined) return;
    mapping[field] = column;
    used.add(column);
  };
  for (const field of IMPORT_FIELDS) {
    const wanted = remembered[field];
    if (!wanted) continue;
    const key = normalizeHeader(wanted);
    if (key === "") continue;
    const column = normalized.findIndex((h, i) => h === key && !used.has(i));
    if (column >= 0) assign(field, column);
  }
  normalized.forEach((header, column) => {
    const field = SYNONYM_LOOKUP.get(header);
    if (field) assign(field, column);
  });
  return mapping;
}

/** Header texts to remember for the next import. */
export function rememberMapping(
  headers: readonly string[],
  mapping: ColumnMapping,
): RememberedMapping {
  const out: RememberedMapping = {};
  for (const field of IMPORT_FIELDS) {
    const column = mapping[field];
    const header = column === undefined ? undefined : headers[column]?.trim();
    if (header) out[field] = header;
  }
  return out;
}

export type MappingProblem =
  { code: "missing"; field: ImportField } | { code: "duplicate_column"; column: number };

/** Required fields must be mapped and no column may feed two fields. */
export function checkMapping(mapping: ColumnMapping): MappingProblem[] {
  const problems: MappingProblem[] = [];
  for (const field of REQUIRED_IMPORT_FIELDS) {
    if (mapping[field] === undefined) problems.push({ code: "missing", field });
  }
  const seen = new Set<number>();
  const reported = new Set<number>();
  for (const field of IMPORT_FIELDS) {
    const column = mapping[field];
    if (column === undefined) continue;
    if (seen.has(column) && !reported.has(column)) {
      reported.add(column);
      problems.push({ code: "duplicate_column", column });
    }
    seen.add(column);
  }
  return problems;
}

/** One record per data row (the row after the header onwards); rows without any mapped text are dropped. */
export function buildRecords(
  table: ParsedTable,
  mapping: ColumnMapping,
): Array<{ line: number; record: ImportRecord }> {
  const out: Array<{ line: number; record: ImportRecord }> = [];
  table.rows.forEach((row, index) => {
    if (index === 0) return; // header row
    const record: ImportRecord = {};
    let any = false;
    for (const field of IMPORT_FIELDS) {
      const column = mapping[field];
      if (column === undefined) continue;
      const value = row[column] ?? "";
      record[field] = value;
      if (value.trim() !== "") any = true;
    }
    if (any) out.push({ line: table.numbers[index] ?? index + 1, record });
  });
  return out;
}

// ---------------------------------------------------------------------------------------------
// Cell cleaning and row validation

export type IssueCode =
  | "required"
  | "too_long"
  | "formula"
  | "bad_country"
  | "duplicate_in_file"
  | "postal_padded"
  | "invalid"
  | "number_taken"
  | "changed_meanwhile";

export type RowIssue = {
  code: IssueCode;
  field?: ImportField;
  max?: number;
  /** `duplicate_in_file`: row of the first occurrence. */
  line?: number;
};

// Control characters and invisible formatting marks (zero-width, bidi) break matching and printing.
const INVISIBLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁠-⁩﻿]/gu;

/**
 * Text that Excel or LibreOffice would execute as a formula when somebody exports or opens the data
 * later (CSV injection): starts with `=`, `@`, TAB or CR, or with `+` / `-` followed by something
 * that is not a plain number or phone number ("+43 1 234", "- Hof" and a lone "-" stay fine).
 */
export function looksLikeFormula(raw: string): boolean {
  if (/^[\t\r]/.test(raw)) return true;
  const text = raw.trimStart();
  if (/^[=@]/.test(text)) return true;
  if (!/^[+-]/.test(text)) return false;
  // "+43 (1) 234-5", "-5", "- Hof" and a lone "-" are fine; "-2+3x" and "+cmd|..." are not.
  return !(/^[+-]\s/u.test(text) || text.length === 1 || /^[+-][\d\s().,/-]*$/u.test(text));
}

/** NFC, invisible characters removed, trimmed. Single-line fields get one line, single spaces. */
export function cleanCell(raw: string, multiline = false): string {
  const base = raw.normalize("NFC").replace(INVISIBLE, "");
  if (multiline) {
    return base
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => line.replace(/[ \t]+/g, " ").trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  return base.replace(/\s+/gu, " ").trim();
}

/** "1001.0" / "1001,00" (floats written by spreadsheets) -> "1001". */
function stripTrailingZeros(value: string): string {
  return value.replace(/^(\d+)[.,]0+$/, "$1");
}

const COUNTRY_NAMES: Record<string, string> = {
  osterreich: "AT",
  austria: "AT",
  oesterreich: "AT",
  deutschland: "DE",
  germany: "DE",
  schweiz: "CH",
  switzerland: "CH",
  suisse: "CH",
  italien: "IT",
  italy: "IT",
  italia: "IT",
  liechtenstein: "LI",
  ungarn: "HU",
  hungary: "HU",
  slowenien: "SI",
  slovenia: "SI",
  slowakei: "SK",
  slovakia: "SK",
  tschechien: "CZ",
  czechia: "CZ",
  frankreich: "FR",
  france: "FR",
  奥地利: "AT",
  德国: "DE",
  瑞士: "CH",
  意大利: "IT",
  奧地利: "AT",
  德國: "DE",
  義大利: "IT",
};

/** 2-letter code, or a known country name (German / English / Chinese) -> code. `null` = unknown. */
export function parseCountry(value: string): string | null {
  if (/^[A-Za-z]{2}$/.test(value)) return value.toUpperCase();
  return COUNTRY_NAMES[normalizeHeader(value)] ?? COUNTRY_NAMES[value] ?? null;
}

/** A row after validation; `country` is `null` when the cell was empty (default or stored value applies). */
export type ValidRow = {
  customerNumber: string;
  name: string;
  street: string;
  postalCode: string;
  city: string;
  country: string | null;
  deliveryHoursInfo: string | null;
  notes: string | null;
};

export type RowValidation = { ok: true; value: ValidRow } | { ok: false; issues: RowIssue[] };

/** Validates and cleans one record (no database, no duplicates across rows). */
export function validateRecord(record: ImportRecord): RowValidation {
  const issues: RowIssue[] = [];
  const cleaned: Partial<Record<ImportField, string>> = {};

  for (const field of IMPORT_FIELDS) {
    const raw = record[field];
    if (raw === undefined) {
      if (REQUIRED_IMPORT_FIELDS.includes(field)) issues.push({ code: "required", field });
      continue;
    }
    if (looksLikeFormula(raw)) {
      issues.push({ code: "formula", field });
      continue;
    }
    let value = cleanCell(raw, field === "notes");
    if (field === "customerNumber" || field === "postalCode") value = stripTrailingZeros(value);
    if (value === "") {
      if (REQUIRED_IMPORT_FIELDS.includes(field)) issues.push({ code: "required", field });
      continue;
    }
    if (field === "country") {
      const code = parseCountry(value);
      if (!code) issues.push({ code: "bad_country", field });
      else cleaned.country = code;
      continue;
    }
    if (value.length > FIELD_MAX_LENGTH[field]) {
      issues.push({ code: "too_long", field, max: FIELD_MAX_LENGTH[field] });
      continue;
    }
    cleaned[field] = value;
  }
  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    value: {
      customerNumber: cleaned.customerNumber!,
      name: cleaned.name!,
      street: cleaned.street!,
      postalCode: cleaned.postalCode!,
      city: cleaned.city!,
      country: cleaned.country ?? null,
      deliveryHoursInfo: cleaned.deliveryHoursInfo ?? null,
      notes: cleaned.notes ?? null,
    },
  };
}

/** Spreadsheets drop the leading zero of German postal codes (01067 -> 1067). */
export function padPostalCode(postalCode: string, country: string): string {
  return country === "DE" && /^\d{4}$/.test(postalCode) ? `0${postalCode}` : postalCode;
}

/** Key used to match a customer number (case-insensitive, as in the form). */
export const numberKey = (customerNumber: string): string => customerNumber.trim().toLowerCase();

// ---------------------------------------------------------------------------------------------
// Plan: create / update / unchanged

export type ExistingCustomer = {
  id: string;
  customerNumber: string;
  name: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
  deliveryHoursInfo: string | null;
  /** German note text ("" when none). */
  notes: string;
  active: boolean;
};

export type RowStatus = "create" | "update" | "unchanged" | "error";

/** What an update changes; absent keys stay as they are. */
export type CustomerPatch = Partial<
  Record<
    "name" | "street" | "postalCode" | "city" | "country" | "deliveryHoursInfo" | "notes",
    string
  >
>;

export type RowPlan = {
  line: number;
  status: RowStatus;
  /** As written in the file (cleaned) or, for unreadable rows, the raw text. */
  customerNumber: string;
  name: string;
  issues: RowIssue[];
  warnings: RowIssue[];
  /** `update`: the fields that differ. */
  changedFields: ImportField[];
  /** `update` of an archived customer: it stays archived. */
  archived: boolean;
  /** The address changed, so the stored pin and its confirmation are dropped (NUD-014 rule). */
  pinReset: boolean;
  existingId: string | null;
  /** `create`: the full row; `update`: only the changed fields. */
  create: (ValidRow & { country: string }) | null;
  patch: CustomerPatch | null;
};

const rawOf = (record: ImportRecord, field: ImportField) => cleanCell(record[field] ?? "");

/**
 * The plan for every file row. Rules:
 * - a customer is matched by number, case-insensitive; the stored spelling of the number is kept;
 * - a number twice in the file: the first row counts, later rows are errors;
 * - empty optional cells (country, delivery hours, notes) never erase stored data;
 * - a changed address drops the pin and its confirmation, an unchanged one keeps both;
 * - an archived customer is updated but not reactivated.
 */
export function planImport(
  rows: ReadonlyArray<{ line: number; record: ImportRecord }>,
  existing: ReadonlyMap<string, ExistingCustomer>,
): RowPlan[] {
  const firstLine = new Map<string, number>();
  return rows.map(({ line, record }) => {
    const base = {
      line,
      customerNumber: rawOf(record, "customerNumber"),
      name: rawOf(record, "name"),
      warnings: [] as RowIssue[],
      changedFields: [] as ImportField[],
      archived: false,
      pinReset: false,
      existingId: null as string | null,
      create: null,
      patch: null,
    };
    const checked = validateRecord(record);
    if (!checked.ok) return { ...base, status: "error" as const, issues: checked.issues };
    const v = checked.value;

    const key = numberKey(v.customerNumber);
    const earlier = firstLine.get(key);
    if (earlier !== undefined) {
      return {
        ...base,
        status: "error" as const,
        issues: [
          { code: "duplicate_in_file" as const, field: "customerNumber" as const, line: earlier },
        ],
      };
    }
    firstLine.set(key, line);

    const stored = existing.get(key) ?? null;
    const country = v.country ?? stored?.country ?? DEFAULT_COUNTRY;
    const postalCode = padPostalCode(v.postalCode, country);
    const warnings: RowIssue[] =
      postalCode !== v.postalCode ? [{ code: "postal_padded", field: "postalCode" }] : [];

    if (!stored) {
      return {
        ...base,
        status: "create" as const,
        issues: [],
        warnings,
        create: { ...v, postalCode, country },
      };
    }

    const patch: CustomerPatch = {};
    const changedFields: ImportField[] = [];
    const set = (field: ImportField, value: string | null, current: string | null) => {
      if (value === null || value === (current ?? "")) return;
      (patch as Record<string, string>)[field] = value;
      changedFields.push(field);
    };
    set("name", v.name, stored.name);
    set("street", v.street, stored.street);
    set("postalCode", postalCode, stored.postalCode);
    set("city", v.city, stored.city);
    set("country", country === stored.country ? null : country, stored.country);
    set("deliveryHoursInfo", v.deliveryHoursInfo, stored.deliveryHoursInfo);
    set("notes", v.notes, stored.notes);

    const pinReset = addressChanged(stored, {
      street: v.street,
      postalCode,
      city: v.city,
      country,
    });
    return {
      ...base,
      status: changedFields.length === 0 ? ("unchanged" as const) : ("update" as const),
      issues: [],
      warnings,
      changedFields,
      archived: !stored.active,
      pinReset,
      existingId: stored.id,
      patch,
    };
  });
}

export type PlanSummary = Record<RowStatus, number>;

export function summarizePlan(plan: readonly RowPlan[]): PlanSummary {
  const summary: PlanSummary = { create: 0, update: 0, unchanged: 0, error: 0 };
  for (const row of plan) summary[row.status] += 1;
  return summary;
}
