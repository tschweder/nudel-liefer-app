/**
 * Pure rules of the customer import (NUD-090): column mapping, cell cleaning, row validation and the
 * create / update / unchanged plan per row. No framework imports; the server (`src/server/
 * customer-import.ts`) loads the existing customers, calls `planImport` and writes the result.
 */
import { addressChanged, suggestNextCustomerNumber } from "./customer";
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
  // NUD-136: the factory's own customer list ("Kunden.xlsx").
  "houseNumber",
  "companyName",
  "vatId",
  "deliveryAddress",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

/**
 * The customer number is optional (NUD-136): a row without one is matched by name, and a new
 * customer gets the next free number.
 */
export const REQUIRED_IMPORT_FIELDS: readonly ImportField[] = [
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
  houseNumber: 40,
  companyName: 160,
  vatId: 32,
  deliveryAddress: 300,
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
    "bezeichnung",
    "kunde",
    "customer",
    "customername",
    "geschaeft",
    "geschaftsname",
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
  houseNumber: ["hausnummer", "hausnr", "hnr", "housenumber", "門牌號", "门牌号"],
  companyName: [
    "firma",
    "firmenname",
    "firmenbezeichnung",
    "rechtstrager",
    "unternehmen",
    "company",
    "companyname",
    "legalname",
    "公司",
    "公司名称",
    "公司名稱",
  ],
  vatId: [
    "uid",
    "uidnummer",
    "uidnr",
    "ustid",
    "ustidnr",
    "umsatzsteuerid",
    "vatid",
    "vat",
    "vatnumber",
    "税号",
    "稅號",
  ],
  deliveryAddress: [
    "lieferadresse",
    "lieferanschrift",
    "abweichendelieferadresse",
    "deliveryaddress",
    "shippingaddress",
    "送货地址",
    "送貨地址",
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
  // A file whose only name column is "Firma" / "Company" (no "Kundenname") keeps using it as the
  // customer name, as before NUD-136.
  if (mapping.name === undefined && mapping.companyName !== undefined) {
    mapping.name = mapping.companyName;
    delete mapping.companyName;
  }
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
  | "changed_meanwhile"
  // NUD-136
  | "number_assigned"
  | "name_ambiguous"
  | "delivery_address_used"
  | "delivery_postal_assumed";

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

/**
 * A row after validation; `country` is `null` when the cell was empty (default or stored value
 * applies), `customerNumber` is `null` when the file has none for this row (NUD-136). `street`
 * already contains the house number. Optional office fields are `null` when empty.
 */
export type ValidRow = {
  customerNumber: string | null;
  name: string;
  street: string;
  postalCode: string;
  city: string;
  country: string | null;
  deliveryHoursInfo: string | null;
  notes: string | null;
  companyName: string | null;
  vatId: string | null;
  billingStreet: string | null;
  billingPostalCode: string | null;
  billingCity: string | null;
};

export type RowValidation =
  { ok: true; value: ValidRow; warnings: RowIssue[] } | { ok: false; issues: RowIssue[] };

/** Digits of a postal code per country (default 4: AT, CH, LI, HU, SI, ...). */
const POSTAL_DIGITS: Record<string, number> = { DE: 5, FR: 5, IT: 5, ES: 5, FI: 5 };

/**
 * Splits a free-text delivery address ("Schönbrunner Straße 230/E10 1120 Wien",
 * "Hauptstraße 5, 60311 Frankfurt") into street, postal code and city. The postal code is the LAST
 * group of the country's postal-code length that is followed by the city at the end of the text,
 * so a house number glued to the postal code ("230/E101120 Wien") still splits right. `null`
 * postal code / city when the text has none ("Handelskai 94-96, Millennium Tower").
 */
export function parseDeliveryAddress(
  text: string,
  country: string,
): { street: string; postalCode: string | null; city: string | null } {
  const digits = POSTAL_DIGITS[country] ?? 4;
  const match = new RegExp(
    `^(.*\\S)?[\\s,]*?(\\d{${digits}})\\s+([^\\d,]*[^\\d\\s,])\\s*$`,
    "u",
  ).exec(text);
  if (match && match[1]) {
    const street = match[1].replace(/[\s,]+$/u, "");
    if (street !== "") return { street, postalCode: match[2]!, city: match[3]!.trim() };
  }
  return { street: text.replace(/[\s,]+$/u, ""), postalCode: null, city: null };
}

/** "atu 1234 5678" -> "ATU12345678" (spaces dropped, upper case). */
export const normalizeVatId = (value: string): string => value.replace(/\s+/gu, "").toUpperCase();

/** Validates and cleans one record (no database, no duplicates across rows). */
export function validateRecord(record: ImportRecord): RowValidation {
  const issues: RowIssue[] = [];
  const warnings: RowIssue[] = [];
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
    if (field === "vatId") value = normalizeVatId(value);
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

  // Street and house number may come in two columns ("Gablenzgasse" + "1/Top11").
  const street = [cleaned.street!, cleaned.houseNumber].filter(Boolean).join(" ");
  if (street.length > FIELD_MAX_LENGTH.street) {
    return {
      ok: false,
      issues: [{ code: "too_long", field: "street", max: FIELD_MAX_LENGTH.street }],
    };
  }
  let delivery = { street, postalCode: cleaned.postalCode!, city: cleaned.city! };
  let billing: { street: string; postalCode: string; city: string } | null = null;

  // A separate delivery address: that one is geocoded, routed and shown to the driver; the address
  // columns become the billing address (office only).
  if (cleaned.deliveryAddress) {
    const parsed = parseDeliveryAddress(
      cleaned.deliveryAddress,
      cleaned.country ?? DEFAULT_COUNTRY,
    );
    if (parsed.street.length > FIELD_MAX_LENGTH.street) {
      return {
        ok: false,
        issues: [{ code: "too_long", field: "deliveryAddress", max: FIELD_MAX_LENGTH.street }],
      };
    }
    billing = delivery;
    delivery = {
      street: parsed.street,
      postalCode: parsed.postalCode ?? billing.postalCode,
      city: parsed.city ?? billing.city,
    };
    warnings.push({ code: "delivery_address_used", field: "deliveryAddress" });
    if (parsed.postalCode === null) {
      warnings.push({ code: "delivery_postal_assumed", field: "deliveryAddress" });
    }
  }

  return {
    ok: true,
    warnings,
    value: {
      customerNumber: cleaned.customerNumber ?? null,
      name: cleaned.name!,
      ...delivery,
      country: cleaned.country ?? null,
      deliveryHoursInfo: cleaned.deliveryHoursInfo ?? null,
      notes: cleaned.notes ?? null,
      companyName: cleaned.companyName ?? null,
      vatId: cleaned.vatId ?? null,
      billingStreet: billing?.street ?? null,
      billingPostalCode: billing?.postalCode ?? null,
      billingCity: billing?.city ?? null,
    },
  };
}

/** Spreadsheets drop the leading zero of German postal codes (01067 -> 1067). */
export function padPostalCode(postalCode: string, country: string): string {
  return country === "DE" && /^\d{4}$/.test(postalCode) ? `0${postalCode}` : postalCode;
}

/** Key used to match a customer number (case-insensitive, as in the form). */
export const numberKey = (customerNumber: string): string => customerNumber.trim().toLowerCase();

/** Key used to match a customer by name when the file has no customer number (NUD-136). */
export const nameKey = (name: string): string => name.trim().replace(/\s+/gu, " ").toLowerCase();

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
  companyName: string | null;
  vatId: string | null;
  billingStreet: string | null;
  billingPostalCode: string | null;
  billingCity: string | null;
  active: boolean;
};

export type RowStatus = "create" | "update" | "unchanged" | "error";

/** Fields an update may change; the import file's columns map onto these. */
export const PATCH_FIELDS = [
  "name",
  "street",
  "postalCode",
  "city",
  "country",
  "deliveryHoursInfo",
  "notes",
  "companyName",
  "vatId",
  "billingStreet",
  "billingPostalCode",
  "billingCity",
] as const;
export type PatchField = (typeof PATCH_FIELDS)[number];

/** What an update changes; absent keys stay as they are. */
export type CustomerPatch = Partial<Record<PatchField, string>>;

/** A new customer: the validated row with its final number and country. */
export type CreateRow = Omit<ValidRow, "customerNumber" | "country"> & {
  customerNumber: string;
  country: string;
};

/** Which file field a changed customer column comes from (for the preview's "changed" list). */
const PATCH_SOURCE: Record<PatchField, ImportField> = {
  name: "name",
  street: "street",
  postalCode: "postalCode",
  city: "city",
  country: "country",
  deliveryHoursInfo: "deliveryHoursInfo",
  notes: "notes",
  companyName: "companyName",
  vatId: "vatId",
  billingStreet: "deliveryAddress",
  billingPostalCode: "deliveryAddress",
  billingCity: "deliveryAddress",
};

export type RowPlan = {
  line: number;
  status: RowStatus;
  /** As written in the file (cleaned), the number assigned to a new customer, or the matched one. */
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
  create: CreateRow | null;
  patch: CustomerPatch | null;
};

const rawOf = (record: ImportRecord, field: ImportField) => cleanCell(record[field] ?? "");

/**
 * The plan for every file row. Rules:
 * - a customer is matched by number, case-insensitive; the stored spelling of the number is kept;
 * - a row without a number is matched by name (case- and whitespace-insensitive, NUD-136); a name
 *   that two stored customers share is an error, an unknown name creates a customer with the next
 *   free number (after every number in the database and in the file);
 * - a number (or, without numbers, a name) twice in the file: the first row counts, later rows are
 *   errors;
 * - empty optional cells (country, delivery hours, notes, company, VAT id, delivery address) never
 *   erase stored data;
 * - a changed address drops the pin and its confirmation, an unchanged one keeps both;
 * - an archived customer is updated but not reactivated.
 */
export function planImport(
  rows: ReadonlyArray<{ line: number; record: ImportRecord }>,
  existing: ReadonlyMap<string, ExistingCustomer>,
): RowPlan[] {
  const byName = new Map<string, ExistingCustomer | "ambiguous">();
  for (const c of existing.values()) {
    const key = nameKey(c.name);
    byName.set(key, byName.has(key) ? "ambiguous" : c);
  }
  // Every number already in use: stored ones and those written in the file.
  const usedNumbers = [...existing.values()].map((c) => c.customerNumber);
  const usedKeys = new Set(usedNumbers.map(numberKey));
  for (const { record } of rows) {
    const n = stripTrailingZeros(cleanCell(record.customerNumber ?? ""));
    if (n !== "" && !usedKeys.has(numberKey(n))) {
      usedNumbers.push(n);
      usedKeys.add(numberKey(n));
    }
  }
  const assignNumber = () => {
    let next = suggestNextCustomerNumber(usedNumbers);
    while (usedKeys.has(numberKey(next))) next = suggestNextCustomerNumber([...usedNumbers, next]);
    usedNumbers.push(next);
    usedKeys.add(numberKey(next));
    return next;
  };

  const firstLine = new Map<string, number>();
  const firstNameLine = new Map<string, number>();
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
    const warnings: RowIssue[] = [...checked.warnings];

    let stored: ExistingCustomer | null;
    if (v.customerNumber !== null) {
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
      stored = existing.get(key) ?? null;
    } else {
      const key = nameKey(v.name);
      const earlier = firstNameLine.get(key);
      if (earlier !== undefined) {
        return {
          ...base,
          status: "error" as const,
          issues: [{ code: "duplicate_in_file" as const, field: "name" as const, line: earlier }],
        };
      }
      firstNameLine.set(key, line);
      const hit = byName.get(key) ?? null;
      if (hit === "ambiguous") {
        return {
          ...base,
          status: "error" as const,
          issues: [{ code: "name_ambiguous" as const, field: "name" as const }],
        };
      }
      stored = hit;
    }

    const country = v.country ?? stored?.country ?? DEFAULT_COUNTRY;
    const postalCode = padPostalCode(v.postalCode, country);
    if (postalCode !== v.postalCode) warnings.push({ code: "postal_padded", field: "postalCode" });

    if (!stored) {
      let customerNumber = v.customerNumber;
      if (customerNumber === null) {
        customerNumber = assignNumber();
        warnings.push({ code: "number_assigned", field: "customerNumber" });
      }
      return {
        ...base,
        customerNumber,
        status: "create" as const,
        issues: [],
        warnings,
        create: { ...v, customerNumber, postalCode, country },
      };
    }

    const patch: CustomerPatch = {};
    const changedFields: ImportField[] = [];
    const set = (field: PatchField, value: string | null, current: string | null) => {
      if (value === null || value === (current ?? "")) return;
      patch[field] = value;
      const source = PATCH_SOURCE[field];
      if (!changedFields.includes(source)) changedFields.push(source);
    };
    set("name", v.name, stored.name);
    set("street", v.street, stored.street);
    set("postalCode", postalCode, stored.postalCode);
    set("city", v.city, stored.city);
    set("country", country === stored.country ? null : country, stored.country);
    set("deliveryHoursInfo", v.deliveryHoursInfo, stored.deliveryHoursInfo);
    set("notes", v.notes, stored.notes);
    set("companyName", v.companyName, stored.companyName);
    set("vatId", v.vatId, stored.vatId);
    set("billingStreet", v.billingStreet, stored.billingStreet);
    set("billingPostalCode", v.billingPostalCode, stored.billingPostalCode);
    set("billingCity", v.billingCity, stored.billingCity);

    const pinReset = addressChanged(stored, {
      street: v.street,
      postalCode,
      city: v.city,
      country,
    });
    return {
      ...base,
      customerNumber: v.customerNumber ?? stored.customerNumber,
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
