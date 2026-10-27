/**
 * One-off day import from a CSV file (NUD-155): `pnpm tsx scripts/import-day-orders.ts <file.csv>
 * [--date YYYY-MM-DD] [--apply] [--skip-errors] [--replace-notes] [--resume] [--actor <email>]`.
 *
 * ONE self-contained file on purpose: it can be copied to the server with a single `scp` and runs
 * there without a rebuild (it imports only server modules that are already deployed). It runs
 * against DATABASE_URL from the environment (on the server: `set -a && . /etc/delivery-app.env &&
 * set +a`), needs no .env file and does not start Next. Dry run by default.
 *
 * One CONFIRMED whole-day order per CSV row is created by the order service (`createOrder`, the
 * path of the office form); the optional driver note is saved on the customer by the customer
 * service (`updateCustomer`, the path of the customer form). Operator guide: docs/day-import.md.
 *
 * Exit codes: 0 = done (dry run without problems, or apply finished), 1 = usage / file / setup
 * problem, 2 = refused or row errors (nothing written), 3 = an apply stopped half way.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { formatCalendarDate, parseCalendarDate } from "../src/domain/order";
import type { PrismaClient } from "../src/generated/prisma/client";
import { DEFAULT_TIMEZONE } from "../src/lib/format";
import { customerInputSchema, notesText, updateCustomer } from "../src/server/customer-admin";
import { createPrismaClient } from "../src/server/db";
import { createOrder, todayIn } from "../src/server/orders";
import { getTourService } from "../src/server/tour-service";
import { getTranslator } from "../src/server/translator";
import { type Translator, TranslatorError } from "../src/server/translator/types";
import { databaseIdentity, redactSecrets } from "./lib/backup";

// ---------------------------------------------------------------------------------------------
// Pure rules: CSV parsing, validation, note rule, idempotency marker
// ---------------------------------------------------------------------------------------------
export const IMPORT_HEADER = ["customerNumber", "menge", "Kiste", "notizen"] as const;
/** Legacy spelling of column 3 (NUD-159): files and templates already on the server keep working. */
const LEGACY_CRATE_COLUMN = "Karton";

/** Largest quantity accepted in one row (a typo guard; the order form allows 99 999). */
export const IMPORT_MAX_QUANTITY = 9999;
/** Largest number of data rows in one file (a typo guard: a route has 10-30 stops). */
export const IMPORT_MAX_ROWS = 1000;
/** `Customer.notes` German text limit of the customer form (`customerInputSchema`). */
export const IMPORT_NOTE_MAX = 2000;

export const SKU_KARTON = "NUDELN-KARTON";
export const SKU_BEUTEL = "NUDELN-BEUTEL";

export type ImportErrorCode =
  | "customer_number_missing"
  | "quantity_invalid"
  | "karton_invalid"
  | "too_many_columns"
  | "too_few_columns"
  | "note_too_long";

/** A data row as read from the file; every cell is already trimmed. */
export type ImportRecord = {
  /** Spreadsheet row number: the header is row 1, the first data row is row 2. */
  row: number;
  customerNumber: string;
  menge: string;
  karton: string;
  notizen: string;
};

export type ParsedRow =
  | {
      ok: true;
      row: number;
      customerNumber: string;
      quantity: number;
      karton: boolean;
      sku: typeof SKU_KARTON | typeof SKU_BEUTEL;
      note: string;
    }
  | { ok: false; row: number; customerNumber: string; code: ImportErrorCode; detail: string };

export type ParsedImport =
  { ok: false; fatal: string } | { ok: true; rows: ParsedRow[]; skippedBlank: number };

/** Strips a UTF-8 byte order mark. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Splits CSV text into records of cells (RFC 4180 with `;`): quoted cells may contain the
 * separator, line breaks and doubled quotes; CRLF and LF both end a record. Returns `null` when a
 * quote is never closed.
 */
export function splitCsv(text: string, separator = ";"): string[][] | null {
  const records: string[][] = [];
  let record: string[] = [];
  let cell = "";
  let inQuotes = false;
  let cellStarted = false;
  const endCell = () => {
    record.push(cell);
    cell = "";
    cellStarted = false;
  };
  const endRecord = () => {
    endCell();
    records.push(record);
    record = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && !cellStarted) {
      inQuotes = true;
      cellStarted = true;
    } else if (ch === separator) endCell();
    else if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      endRecord();
    } else if (ch === "\n") endRecord();
    else {
      cell += ch;
      cellStarted = true;
    }
  }
  if (inQuotes) return null;
  if (cellStarted || cell !== "" || record.length > 0) endRecord();
  return records;
}

/** Quantity cell: digits only, 1..IMPORT_MAX_QUANTITY ("2,5", "0", "-1", "abc", "3.0" are rejected). */
export function parseImportQuantity(cell: string): number | null {
  const text = cell.trim();
  if (!/^\d{1,5}$/.test(text)) return null;
  const value = Number(text);
  return value >= 1 && value <= IMPORT_MAX_QUANTITY ? value : null;
}

/** Kiste cell: `ja` / `nein`, any case, surrounding spaces ignored; anything else is `null`. */
export function parseKarton(cell: string): boolean | null {
  const text = cell.trim().toLowerCase();
  if (text === "ja") return true;
  if (text === "nein") return false;
  return null;
}

/** Line breaks inside a quoted note become one space; the text is otherwise kept verbatim. */
export function cleanNote(cell: string): string {
  return cell
    .replace(/\r\n|\r|\n/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

const blank = (cells: readonly string[]) => cells.every((c) => c.trim() === "");

/**
 * Parses and validates the whole file. A wrong header, a broken quote or a file without data rows
 * is `fatal`; every other problem is reported per row (the other rows are still checked).
 * Completely empty rows (Excel's trailing `;;;`) are skipped and counted.
 */
export function parseDayCsv(rawText: string): ParsedImport {
  const records = splitCsv(stripBom(rawText));
  if (records === null) return { ok: false, fatal: "A quoted cell is never closed (odd quotes)." };
  const first = records.findIndex((r) => !blank(r));
  if (first < 0) return { ok: false, fatal: "The file is empty." };
  const header = records[first]!.map((c) => c.trim());
  if (header[2] === LEGACY_CRATE_COLUMN) header[2] = IMPORT_HEADER[2];
  // Excel keeps empty trailing columns; drop them before comparing.
  while (header.length > IMPORT_HEADER.length && header[header.length - 1] === "") header.pop();
  if (header.length !== IMPORT_HEADER.length || header.some((h, i) => h !== IMPORT_HEADER[i])) {
    const hint =
      header.length === 1 && /[,\t]/.test(header[0]!)
        ? " The columns must be separated by semicolons (;), not commas or tabs."
        : "";
    return {
      ok: false,
      fatal: `Wrong header. Expected exactly "${IMPORT_HEADER.join(";")}" but found "${header.join(";")}".${hint}`,
    };
  }

  const rows: ParsedRow[] = [];
  let skippedBlank = 0;
  records.forEach((cells, index) => {
    if (index <= first) return;
    if (blank(cells)) {
      skippedBlank++;
      return;
    }
    const rowNo = index + 1;
    const customerNumber = (cells[0] ?? "").trim();
    const fail = (code: ImportErrorCode, detail: string): ParsedRow => ({
      ok: false,
      row: rowNo,
      customerNumber,
      code,
      detail,
    });
    const extra = cells.slice(IMPORT_HEADER.length).some((c) => c.trim() !== "");
    if (extra) {
      rows.push(fail("too_many_columns", "More than 4 columns (is a ; inside the note quoted?)"));
      return;
    }
    if (cells.length < 3) {
      rows.push(fail("too_few_columns", "Fewer than 3 columns (customerNumber;menge;Kiste)"));
      return;
    }
    if (customerNumber === "") {
      rows.push(fail("customer_number_missing", "customerNumber is empty"));
      return;
    }
    const quantity = parseImportQuantity(cells[1] ?? "");
    if (quantity === null) {
      rows.push(
        fail(
          "quantity_invalid",
          `menge "${(cells[1] ?? "").trim()}" is not a whole number from 1 to ${IMPORT_MAX_QUANTITY}`,
        ),
      );
      return;
    }
    const karton = parseKarton(cells[2] ?? "");
    if (karton === null) {
      rows.push(fail("karton_invalid", `Kiste "${(cells[2] ?? "").trim()}" must be ja or nein`));
      return;
    }
    const note = cleanNote(cells[3] ?? "");
    if (note.length > IMPORT_NOTE_MAX) {
      rows.push(
        fail("note_too_long", `notizen has ${note.length} characters (max ${IMPORT_NOTE_MAX})`),
      );
      return;
    }
    rows.push({
      ok: true,
      row: rowNo,
      customerNumber,
      quantity,
      karton,
      sku: karton ? SKU_KARTON : SKU_BEUTEL,
      note,
    });
  });
  if (rows.length === 0) return { ok: false, fatal: "The file has a header but no data rows." };
  if (rows.length > IMPORT_MAX_ROWS) {
    return { ok: false, fatal: `More than ${IMPORT_MAX_ROWS} data rows (${rows.length}).` };
  }
  return { ok: true, rows, skippedBlank };
}

export type NoteAction =
  /** Empty CSV note: the stored note is left alone. */
  | "none"
  /** Stored note was empty: the CSV text becomes the note. */
  | "set"
  /** Stored note is kept and ` | <csv text>` is appended. */
  | "append"
  /** Stored note already contains the CSV text. */
  | "unchanged"
  /** `--replace-notes`: the CSV text overwrites the stored note. */
  | "replace";

export const NOTE_SEPARATOR = " | ";

/**
 * Decision (backlog 9, NUD-155) for an existing driver note: an empty CSV note changes nothing; an
 * empty stored note is set; otherwise the text is appended with " | " unless the stored note
 * already contains it; `replace` overwrites instead (unless it is already exactly the text).
 */
export function combineNote(
  stored: string,
  csv: string,
  replace: boolean,
): { action: NoteAction; text: string } {
  const current = stored.trim();
  const text = csv.trim();
  if (text === "") return { action: "none", text: current };
  if (replace) {
    return current === text ? { action: "unchanged", text: current } : { action: "replace", text };
  }
  if (current === "") return { action: "set", text };
  if (current.includes(text)) return { action: "unchanged", text: current };
  return { action: "append", text: `${current}${NOTE_SEPARATOR}${text}` };
}

/** Prefix of the marker stored in `Order.internalNote` (idempotency, see `importMarker`). */
export const MARKER_PREFIX = "CSV day import";

/** Length of the hash part of the marker (hex characters of the file's sha256). */
export const MARKER_HASH_LENGTH = 16;

/** Common prefix of all markers of one file and one delivery day (`YYYY-MM-DD`). */
export function importMarkerPrefix(sha256: string, date: string): string {
  return `${MARKER_PREFIX} ${sha256.slice(0, MARKER_HASH_LENGTH)} ${date} row `;
}

/**
 * The text written to `Order.internalNote` of every imported order. File hash, day and row number
 * make a second run of the same file and day recognisable ("refuse to apply the same file twice")
 * and let `--resume` create only the rows that are missing after an interrupted run. The day is
 * part of the marker, not looked up from the order: the office may move the planned day later.
 */
export function importMarker(sha256: string, date: string, row: number): string {
  return `${importMarkerPrefix(sha256, date)}${row}`;
}

/** The row number of a marker of this file and day, or `null`. */
export function markerRow(
  sha256: string,
  date: string,
  internalNote: string | null,
): number | null {
  const prefix = importMarkerPrefix(sha256, date);
  if (!internalNote?.startsWith(prefix)) return null;
  const rest = internalNote.slice(prefix.length);
  return /^\d+$/.test(rest) ? Number(rest) : null;
}

// ---------------------------------------------------------------------------------------------
// Planning and applying (reads and writes through the order and customer services)
// ---------------------------------------------------------------------------------------------
/**
 * One-off day import from a CSV file (NUD-155): one CONFIRMED whole-day order per row, created by
 * the order service (`createOrder`, the path of the office form), plus the optional driver note on
 * the customer, saved by the customer service (`updateCustomer`, the path of the customer form).
 * `buildDayImportPlan` reads only; `applyDayImport` writes. The command line is
 * `scripts/import-day-orders.ts`; operator guide: `docs/day-import.md`.
 */

export type DayImportDb = PrismaClient;

export type ImportWarning = "no_navigation" | "has_confirmed_orders" | "customer_repeated";

export type PlanRow = {
  row: number;
  customerNumber: string;
  status: "ok" | "error";
  /** Reason for `status: "error"`. */
  error?: string;
  customer?: { id: string; name: string; city: string };
  sku?: string;
  /** Product as shown in the table, e.g. `Kiste 10 kg`. */
  product?: string;
  productId?: string;
  quantity?: number;
  /** The CSV note (already cleaned). */
  note: string;
  noteAction: NoteAction | null;
  /** Orders already created for this row by an earlier run of the same file (`--resume`). */
  alreadyImported: boolean;
  warnings: ImportWarning[];
  /** Number of confirmed orders the customer already has for the day (not from this file). */
  existingConfirmed: number;
};

export type DayImportPlan = {
  sha256: string;
  /** `YYYY-MM-DD` */
  date: string;
  actor: { id: string; email: string };
  rows: PlanRow[];
  skippedBlank: number;
  replaceNotes: boolean;
  /** Rows of this file that already have an order (an earlier run of the same file and day). */
  importedRows: number[];
};

export type PlanOptions = {
  /** `YYYY-MM-DD`; default: today in the factory time zone. */
  date?: string;
  actorEmail?: string;
  replaceNotes?: boolean;
  now?: Date;
};

export type PlanResult = { ok: true; plan: DayImportPlan } | { ok: false; fatal: string };

/** sha256 (hex) of the exact file bytes. */
export function fileSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Strict UTF-8 decoding: Windows-1252 files ("Save as CSV" without UTF-8) are refused, not garbled. */
export function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
}

async function factoryToday(db: DayImportDb, now: Date): Promise<Date> {
  const settings = await db.settings.findUnique({ where: { id: 1 }, select: { timezone: true } });
  return todayIn(settings?.timezone ?? DEFAULT_TIMEZONE, now);
}

type CustomerRow = NonNullable<Awaited<ReturnType<typeof loadCustomers>>[number]>;

async function loadCustomers(db: DayImportDb) {
  return db.customer.findMany({ include: { _count: { select: { parkingSpots: true } } } });
}

/** The customer form input that saves `note` and leaves everything else as stored. */
export function customerFormInput(c: CustomerRow, note: string | null) {
  return {
    customerNumber: c.customerNumber,
    name: c.name,
    street: c.street,
    postalCode: c.postalCode,
    city: c.city,
    country: c.country,
    lat: c.lat,
    lng: c.lng,
    deliveryHoursInfo: c.deliveryHoursInfo,
    notes: note,
    companyName: c.companyName,
    vatId: c.vatId,
    billingStreet: c.billingStreet,
    billingPostalCode: c.billingPostalCode,
    billingCity: c.billingCity,
  };
}

const KARTON_KG = 10;
const BEUTEL_KG = 3;

/**
 * Reads the file's rows against the database and returns what an apply would do. Writes nothing.
 * `fatal` = nothing can be shown (bad file, bad date, products missing, no admin); row problems
 * are rows with `status: "error"`.
 */
export async function buildDayImportPlan(
  db: DayImportDb,
  bytes: Uint8Array,
  options: PlanOptions = {},
): Promise<PlanResult> {
  const text = decodeUtf8(bytes);
  if (text === null) {
    return {
      ok: false,
      fatal: 'The file is not UTF-8. In Excel use "Save as" > "CSV UTF-8 (Comma delimited)".',
    };
  }
  const parsed = parseDayCsv(text);
  if (!parsed.ok) return { ok: false, fatal: parsed.fatal };

  const today = await factoryToday(db, options.now ?? new Date());
  const date = options.date ?? formatCalendarDate(today);
  const day = parseCalendarDate(date);
  if (!day) return { ok: false, fatal: `Invalid date "${date}" (use YYYY-MM-DD).` };
  if (day.getTime() < today.getTime()) {
    return {
      ok: false,
      fatal: `The date ${date} lies in the past (today is ${formatCalendarDate(today)}); the order service refuses past days.`,
    };
  }

  const actorEmail = options.actorEmail?.trim();
  const actor = actorEmail
    ? await db.user.findFirst({
        where: { email: { equals: actorEmail, mode: "insensitive" }, role: "ADMIN", active: true },
        select: { id: true, email: true },
      })
    : await db.user.findFirst({
        where: { role: "ADMIN", active: true },
        orderBy: { createdAt: "asc" },
        select: { id: true, email: true },
      });
  if (!actor) {
    return {
      ok: false,
      fatal: actorEmail
        ? `No active ADMIN user with the email ${actorEmail}.`
        : "No active ADMIN user found (use --actor <email>).",
    };
  }

  const products = await db.product.findMany({
    where: { sku: { in: [SKU_KARTON, SKU_BEUTEL] } },
    select: { id: true, sku: true, unit: true, weightKgPerUnit: true, active: true },
  });
  const karton = products.find((p) => p.sku === SKU_KARTON);
  const beutel = products.find((p) => p.sku === SKU_BEUTEL);
  for (const [sku, p, unit, kg] of [
    [SKU_KARTON, karton, "CRATE", KARTON_KG],
    [SKU_BEUTEL, beutel, "PACK", BEUTEL_KG],
  ] as const) {
    if (!p) return { ok: false, fatal: `Product ${sku} does not exist.` };
    if (!p.active) return { ok: false, fatal: `Product ${sku} is archived.` };
    if (p.unit !== unit || Number(p.weightKgPerUnit) !== kg) {
      return {
        ok: false,
        fatal: `Product ${sku} is not ${kg} kg per ${unit} any more (catalog changed); refusing to guess.`,
      };
    }
  }

  const customers = new Map(
    (await loadCustomers(db)).map((c) => [c.customerNumber.toLowerCase(), c]),
  );

  const sha256 = fileSha256(bytes);
  const prefix = importMarkerPrefix(sha256, date);
  const earlier = await db.order.findMany({
    where: { internalNote: { startsWith: prefix } },
    select: { internalNote: true },
  });
  const importedRows = earlier
    .map((o) => markerRow(sha256, date, o.internalNote))
    .filter((r): r is number => r !== null);

  const confirmed = await db.order.groupBy({
    by: ["customerId"],
    where: {
      deliveryDate: day,
      status: "CONFIRMED",
      NOT: { internalNote: { startsWith: prefix } },
    },
    _count: { _all: true },
  });
  const confirmedByCustomer = new Map(confirmed.map((g) => [g.customerId, g._count._all]));

  const okPerCustomer = new Map<string, number>();
  for (const r of parsed.rows) {
    if (!r.ok) continue;
    const key = r.customerNumber.toLowerCase();
    okPerCustomer.set(key, (okPerCustomer.get(key) ?? 0) + 1);
  }

  // Notes are simulated row by row (several rows of one customer append to each other).
  const notes = new Map<string, string>();
  const rows: PlanRow[] = parsed.rows.map((r): PlanRow => {
    const base = { row: r.row, customerNumber: r.customerNumber };
    if (!r.ok) {
      return {
        ...base,
        status: "error",
        error: r.detail,
        note: "",
        noteAction: null,
        alreadyImported: false,
        warnings: [],
        existingConfirmed: 0,
      };
    }
    const err = (error: string): PlanRow => ({
      ...base,
      status: "error",
      error,
      note: r.note,
      noteAction: null,
      alreadyImported: false,
      warnings: [],
      existingConfirmed: 0,
    });
    const customer = customers.get(r.customerNumber.toLowerCase());
    if (!customer) return err(`Unknown customerNumber ${r.customerNumber}`);
    if (!customer.active) return err("Customer is deactivated");

    const product = r.karton ? karton! : beutel!;
    const stored = notes.get(customer.id) ?? notesText(customer.notes);
    const combined = combineNote(stored, r.note, options.replaceNotes === true);
    const changes =
      combined.action === "set" || combined.action === "append" || combined.action === "replace";
    if (changes && combined.text.length > IMPORT_NOTE_MAX) {
      return err(
        `The customer note would be ${combined.text.length} characters (max ${IMPORT_NOTE_MAX})`,
      );
    }
    if (
      changes &&
      !customerInputSchema.safeParse(customerFormInput(customer, combined.text)).success
    ) {
      return err("The customer record fails the customer form validation; fix the customer first");
    }
    notes.set(customer.id, combined.text);

    const warnings: ImportWarning[] = [];
    if (customer.lat === null && customer._count.parkingSpots === 0) warnings.push("no_navigation");
    const existing = confirmedByCustomer.get(customer.id) ?? 0;
    if (existing > 0) warnings.push("has_confirmed_orders");
    if ((okPerCustomer.get(r.customerNumber.toLowerCase()) ?? 0) > 1)
      warnings.push("customer_repeated");
    return {
      ...base,
      status: "ok",
      customer: { id: customer.id, name: customer.name, city: customer.city },
      sku: r.sku,
      product: r.karton ? `Kiste ${KARTON_KG} kg` : `Sackerl ${BEUTEL_KG} kg`,
      productId: product.id,
      quantity: r.quantity,
      note: r.note,
      noteAction: combined.action,
      alreadyImported: importedRows.includes(r.row),
      warnings,
      existingConfirmed: existing,
    };
  });

  return {
    ok: true,
    plan: {
      sha256,
      date,
      actor: { id: actor.id, email: actor.email ?? "" },
      rows,
      skippedBlank: parsed.skippedBlank,
      replaceNotes: options.replaceNotes === true,
      importedRows,
    },
  };
}

/** Translator that always fails retryably: the note is stored in German and the retry job translates it. */
export const deferredTranslator: Translator = {
  kind: "fake",
  async translate() {
    throw new TranslatorError("translation deferred to the retry job", "NETWORK");
  },
};

export type ApplyOptions = {
  /** Translate the notes now with the configured translator (DeepL) instead of leaving it to the retry job. */
  translateNow?: boolean;
  /** Called after every row (progress output). */
  onRow?: (line: {
    row: number;
    customerNumber: string;
    orderId: string;
    noteChanged: boolean;
  }) => void;
  now?: Date;
};

export type ApplyResult = {
  created: { row: number; customerNumber: string; orderId: string }[];
  notesChanged: number;
  /** Rows skipped because an earlier run already created their order (`--resume`). */
  alreadyImported: number;
  /** The row that stopped the run (nothing after it was written). */
  failed?: { row: number; customerNumber: string; message: string };
};

/** Runs `fn` with the translator's own warnings muted: they are expected when translation is deferred. */
async function quietTranslatorWarnings<T>(mute: boolean, fn: () => Promise<T>): Promise<T> {
  if (!mute) return fn();
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].startsWith("[translator]")) return;
    original(...args);
  };
  try {
    return await fn();
  } finally {
    console.warn = original;
  }
}

const noStorage = { head: async () => null };

/**
 * Creates the orders of the plan's `ok` rows, one after the other. Per row: the customer note
 * first (idempotent: a note that already contains the text is not written again), then the order
 * (its own transaction, with audit entry and outdated-tour flag). The first failure stops the run
 * and is returned; rows before it stay created, and `--resume` creates the rest. Rows with a
 * marker order are skipped. The caller decides whether error rows may be left out.
 */
export async function applyDayImport(
  db: DayImportDb,
  plan: DayImportPlan,
  options: ApplyOptions = {},
): Promise<ApplyResult> {
  const today = await factoryToday(db, options.now ?? new Date());
  const translator = options.translateNow ? getTranslator() : deferredTranslator;
  const result: ApplyResult = { created: [], notesChanged: 0, alreadyImported: 0 };

  for (const row of plan.rows) {
    if (row.status !== "ok") continue;
    if (row.alreadyImported) {
      result.alreadyImported++;
      continue;
    }
    try {
      const customer = await db.customer.findUnique({
        where: { id: row.customer!.id },
        include: { _count: { select: { parkingSpots: true } } },
      });
      if (!customer || !customer.active) throw new Error("customer is gone or deactivated");

      const combined = combineNote(notesText(customer.notes), row.note, plan.replaceNotes);
      const noteChanges =
        combined.action === "set" || combined.action === "append" || combined.action === "replace";
      if (noteChanges) {
        const saved = await quietTranslatorWarnings(!options.translateNow, () =>
          updateCustomer(db, customer.id, customerFormInput(customer, combined.text), {
            translator,
            actorId: plan.actor.id,
          }),
        );
        if (!saved.ok) throw new Error(`customer note not saved (${saved.error})`);
        result.notesChanged++;
      }

      const order = await createOrder(
        db,
        plan.actor.id,
        {
          customerId: customer.id,
          deliveryDate: plan.date,
          windowFrom: plan.date,
          windowTo: plan.date,
          status: "CONFIRMED",
          internalNote: importMarker(plan.sha256, plan.date, row.row),
          lines: [{ productId: row.productId!, quantity: row.quantity! }],
        },
        today,
        noStorage,
        getTourService(),
      );
      if (!order.ok) throw new Error(`order not created (${order.error})`);
      result.created.push({ row: row.row, customerNumber: row.customerNumber, orderId: order.id });
      options.onRow?.({
        row: row.row,
        customerNumber: row.customerNumber,
        orderId: order.id,
        noteChanged: noteChanges,
      });
    } catch (error) {
      result.failed = {
        row: row.row,
        customerNumber: row.customerNumber,
        message: error instanceof Error ? error.message : String(error),
      };
      break;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// Command line: arguments, dry-run table, the run
// ---------------------------------------------------------------------------------------------
export const USAGE = `Usage: pnpm tsx scripts/import-day-orders.ts <file.csv> [options]

  Imports one day of orders from a CSV file (header: customerNumber;menge;Kiste;notizen; "Karton" is still accepted).
  Default is a DRY RUN: it prints what would happen and writes nothing.

Options:
  --date YYYY-MM-DD   delivery day (default: today in the factory time zone)
  --apply             really create the orders (and save the notes)
  --skip-errors       with --apply: leave rows with errors out instead of refusing
  --replace-notes     overwrite existing customer notes instead of appending
  --resume            with --apply: finish a file whose earlier run stopped half way
                      (creates only the rows that have no order yet)
  --actor <email>     ADMIN user the orders are attributed to (default: first active ADMIN)
  --translate-now     translate the notes right away with the configured translator
                      (default: the retry job translates them within minutes)
  --help              this text
`;

export type CliArgs = {
  file: string | null;
  date?: string;
  apply: boolean;
  skipErrors: boolean;
  replaceNotes: boolean;
  resume: boolean;
  actor?: string;
  translateNow: boolean;
  help: boolean;
  unknown: string[];
};

export function parseCliArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = {
    file: null,
    apply: false,
    skipErrors: false,
    replaceNotes: false,
    resume: false,
    translateNow: false,
    help: false,
    unknown: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const eq = arg.indexOf("=");
    const name = arg.startsWith("--") && eq > 0 ? arg.slice(0, eq) : arg;
    const inline = arg.startsWith("--") && eq > 0 ? arg.slice(eq + 1) : undefined;
    const value = () => inline ?? argv[++i];
    switch (name) {
      case "--apply":
        args.apply = true;
        break;
      case "--skip-errors":
        args.skipErrors = true;
        break;
      case "--replace-notes":
        args.replaceNotes = true;
        break;
      case "--resume":
        args.resume = true;
        break;
      case "--translate-now":
        args.translateNow = true;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      case "--date": {
        const v = value();
        if (v === undefined) args.unknown.push("--date (value missing)");
        else args.date = v.trim();
        break;
      }
      case "--actor": {
        const v = value();
        if (v === undefined) args.unknown.push("--actor (value missing)");
        else args.actor = v.trim();
        break;
      }
      default:
        if (arg.startsWith("-")) args.unknown.push(arg);
        else if (args.file === null) args.file = arg;
        else args.unknown.push(arg);
    }
  }
  return args;
}

const pad = (value: string, width: number) =>
  value.length >= width ? value.slice(0, width - 1) + "…" : value.padEnd(width);

const WARNING_TEXT: Record<ImportWarning, (row: PlanRow) => string> = {
  no_navigation: () => "no address point and no Parkplatz: no navigation button until geocoded",
  has_confirmed_orders: (row) =>
    `customer already has ${row.existingConfirmed} confirmed order(s) for this day (they merge into one stop)`,
  customer_repeated: () => "customer appears several times in the file (one stop, several orders)",
};

/** The dry-run table, the warnings and the summary as text lines. */
export function renderPlan(plan: DayImportPlan): string[] {
  const lines: string[] = [];
  const head = `${pad("row", 4)} ${pad("number", 7)} ${pad("customer", 28)} ${pad("city", 14)} ${pad("product", 13)} ${pad("qty", 5)} ${pad("note", 9)} status`;
  lines.push(head, "-".repeat(head.length));
  for (const r of plan.rows) {
    const status =
      r.status === "ok"
        ? r.alreadyImported
          ? "DONE (already imported)"
          : "OK"
        : `ERROR: ${r.error}`;
    lines.push(
      [
        pad(String(r.row), 4),
        pad(r.customerNumber, 7),
        pad(r.customer?.name ?? "-", 28),
        pad(r.customer?.city ?? "-", 14),
        pad(r.product ?? "-", 13),
        pad(r.quantity === undefined ? "-" : String(r.quantity), 5),
        pad(r.noteAction ?? "-", 9),
        status,
      ].join(" "),
    );
    for (const w of r.warnings)
      lines.push(`${" ".repeat(5)}WARNING row ${r.row}: ${WARNING_TEXT[w](r)}`);
  }
  const ok = plan.rows.filter((r) => r.status === "ok");
  const errors = plan.rows.length - ok.length;
  const todo = ok.filter((r) => !r.alreadyImported);
  const noteChanges = todo.filter((r) => ["set", "append", "replace"].includes(r.noteAction ?? ""));
  const customers = new Set(todo.map((r) => r.customer!.id));
  lines.push(
    "",
    `File sha256:   ${plan.sha256}`,
    `Delivery day:  ${plan.date}`,
    `Attributed to: ${plan.actor.email}`,
    `Rows:          ${plan.rows.length} (${ok.length} ok, ${errors} with errors${plan.skippedBlank ? `, ${plan.skippedBlank} blank rows ignored` : ""})`,
    `Would create:  ${todo.length} confirmed orders for ${customers.size} customers`,
    `Would change:  ${noteChanges.length} customer notes (${plan.replaceNotes ? "replace" : "append"} mode)`,
  );
  if (plan.importedRows.length > 0) {
    lines.push(
      `Earlier run:   ${plan.importedRows.length} rows of this file and day already have an order`,
    );
  }
  return lines;
}

export type CliDeps = {
  db: DayImportDb;
  out: (line: string) => void;
  err: (line: string) => void;
  readFile?: (path: string) => Uint8Array;
  now?: Date;
  /** Environment for the `--translate-now` check. */
  env?: Record<string, string | undefined>;
};

/** Runs the import; returns the process exit code. Never calls `process.exit`. */
export async function runDayImport(argv: readonly string[], deps: CliDeps): Promise<number> {
  const { out, err } = deps;
  const args = parseCliArgs(argv);
  if (args.help) {
    out(USAGE);
    return 0;
  }
  if (args.unknown.length > 0 || args.file === null) {
    if (args.unknown.length > 0) err(`Unknown or incomplete argument: ${args.unknown.join(", ")}`);
    else err("No CSV file given.");
    err(USAGE);
    return 1;
  }
  if (args.translateNow && !(deps.env ?? process.env).DEEPL_API_KEY?.trim()) {
    err("--translate-now needs DEEPL_API_KEY in the environment.");
    return 1;
  }

  let bytes: Uint8Array;
  try {
    bytes = (deps.readFile ?? readFileSync)(args.file);
  } catch {
    err(`Cannot read the file ${args.file}.`);
    return 1;
  }

  const planned = await buildDayImportPlan(deps.db, bytes, {
    date: args.date,
    actorEmail: args.actor,
    replaceNotes: args.replaceNotes,
    now: deps.now,
  });
  if (!planned.ok) {
    err(`ERROR: ${planned.fatal}`);
    return 1;
  }
  const plan = planned.plan;
  for (const line of renderPlan(plan)) out(line);

  const okRows = plan.rows.filter((r) => r.status === "ok");
  const errorRows = plan.rows.filter((r) => r.status === "error");
  const todo = okRows.filter((r) => !r.alreadyImported);

  if (!args.apply) {
    out("");
    if (plan.importedRows.length > 0) {
      out(
        `NOTE: this file was already imported for ${plan.date} (${plan.importedRows.length} rows). --apply would be refused${todo.length > 0 ? " unless you add --resume" : ""}.`,
      );
    }
    if (errorRows.length > 0) {
      out(
        `${errorRows.length} row(s) have errors: fix the file, or use --apply --skip-errors to leave them out.`,
      );
      out("DRY RUN: nothing was written.");
      return 2;
    }
    out("DRY RUN: nothing was written. Add --apply to create the orders.");
    return 0;
  }

  // --- apply: refuse before writing anything ---
  out("");
  if (errorRows.length > 0 && !args.skipErrors) {
    err(
      `REFUSED: ${errorRows.length} row(s) have errors. Fix the file, or add --skip-errors to leave them out. Nothing was written.`,
    );
    return 2;
  }
  if (plan.importedRows.length > 0 && !args.resume) {
    err(
      `REFUSED: this file was already imported for ${plan.date} (${plan.importedRows.length} of ${okRows.length} rows have an order). Nothing was written.${todo.length > 0 ? " If an earlier run stopped half way, run again with --resume." : ""}`,
    );
    return 2;
  }
  if (todo.length === 0) {
    err(
      args.resume
        ? "Nothing to do: every row already has an order."
        : "REFUSED: no valid rows to import. Nothing was written.",
    );
    return args.resume ? 0 : 2;
  }
  if (errorRows.length > 0) {
    out(
      `Leaving out ${errorRows.length} row(s) with errors (--skip-errors): ${errorRows.map((r) => r.row).join(", ")}`,
    );
  }

  out(`Creating ${todo.length} orders for ${plan.date} ...`);
  const result = await applyDayImport(deps.db, plan, {
    translateNow: args.translateNow,
    now: deps.now,
    onRow: (l) =>
      out(
        `  row ${l.row}: customer ${l.customerNumber} -> order ${l.orderId}${l.noteChanged ? " (note saved)" : ""}`,
      ),
  });

  out("");
  out(`Orders created:  ${result.created.length}`);
  out(`Notes changed:   ${result.notesChanged}`);
  if (result.alreadyImported > 0) out(`Skipped (done earlier): ${result.alreadyImported}`);
  if (result.created.length > 0) {
    out("Order ids:");
    for (const c of result.created) out(`  row ${c.row}  ${c.customerNumber}  ${c.orderId}`);
  }
  if (errorRows.length > 0) out(`Rows left out:   ${errorRows.map((r) => r.row).join(", ")}`);
  if (result.failed) {
    err("");
    err(
      `STOPPED at row ${result.failed.row} (customer ${result.failed.customerNumber}): ${result.failed.message}`,
    );
    err(
      "The rows above are created, the rest is NOT. Fix the cause, then run the same command again with --resume.",
    );
    return 3;
  }
  out("");
  out("Next steps in the office:");
  out("  1. Bestellungen: check that the orders of the day are listed as confirmed.");
  out(
    '  2. Touren > Touren planen (pick the vehicle and driver, "Jetzt planen"), then check the stops.',
  );
  out("  3. Touren > Freigeben, so the driver sees the tour.");
  if (!args.translateNow && result.notesChanged > 0) {
    out(
      "Note translations are filled in by the retry job within a few minutes (German is shown until then).",
    );
  }
  return 0;
}

// ---------------------------------------------------------------------------------------------
// Entry point: only when this file is run, not when a test imports it.
// ---------------------------------------------------------------------------------------------

async function main(): Promise<number> {
  if (process.argv.some((a) => a === "--help" || a === "-h")) {
    console.log(USAGE);
    return 0;
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      "DATABASE_URL is not set. On the server: set -a && . /etc/delivery-app.env && set +a",
    );
    return 1;
  }
  const db = createPrismaClient(url);
  try {
    console.log(`Database: ${databaseIdentity(url)}`);
    return await runDayImport(process.argv.slice(2), {
      db,
      out: (line) => console.log(line),
      err: (line) => console.error(line),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`FAILED: ${redactSecrets(message, [url])}`);
    return 3;
  } finally {
    await db.$disconnect();
  }
}

if (/[\\/]import-day-orders\.ts$/.test(process.argv[1] ?? "")) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
