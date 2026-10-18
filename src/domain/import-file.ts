/**
 * Pure helpers for reading customer import files (NUD-090): limits, text decoding, a small RFC 4180
 * CSV parser and the zip-bomb check for XLSX files. No framework imports; the XLSX reader itself
 * lives in `src/server/import-xlsx.ts` because it needs the `exceljs` package.
 */

export const IMPORT_LIMITS = {
  /** Uploaded file size. */
  maxBytes: 5 * 1024 * 1024,
  /** Data rows, the header row excluded. */
  maxRows: 2000,
  maxColumns: 50,
  /** Characters per cell. */
  maxCellLength: 2000,
  /** XLSX is a zip: entries and declared uncompressed size are capped before anything is inflated. */
  maxZipEntries: 200,
  maxZipUncompressedBytes: 50 * 1024 * 1024,
} as const;

export type ImportFileErrorCode =
  | "too_large"
  | "empty"
  | "unsupported_type"
  | "too_many_rows"
  | "too_many_columns"
  | "cell_too_long"
  | "bad_csv"
  | "bad_xlsx"
  | "zip_bomb";

export class ImportFileError extends Error {
  constructor(readonly code: ImportFileErrorCode) {
    super(code);
    this.name = "ImportFileError";
  }
}

/** The cells of a file as text plus the position of every row in the source (1-based). */
export type ParsedTable = { rows: string[][]; numbers: number[] };

export type FileKind = "csv" | "xlsx";

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

/** CSV or XLSX by content first (zip signature), then by extension. `null` = not supported. */
export function detectFileKind(bytes: Uint8Array, filename: string): FileKind | null {
  if (ZIP_MAGIC.every((b, i) => bytes[i] === b)) return "xlsx";
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "xlsx") return null; // claims to be a workbook but is not a zip
  // Legacy binary .xls (OLE2) is not supported.
  if ([0xd0, 0xcf, 0x11, 0xe0].every((b, i) => bytes[i] === b)) return null;
  if (ext === "csv" || ext === "txt" || ext === "tsv") return "csv";
  return null;
}

/**
 * Bytes -> text. UTF-8 (BOM removed) first; UTF-16 with BOM ("Unicode text" from Excel); anything
 * that is not valid UTF-8 is read as windows-1252, which is what older German Excel versions write.
 */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

const DELIMITERS = [",", ";", "\t"] as const;
export type Delimiter = (typeof DELIMITERS)[number];

/** Delimiter of a CSV text: an Excel `sep=` line wins, otherwise the most frequent of `, ; TAB` in the header line. */
export function detectDelimiter(text: string): Delimiter {
  const sep = /^sep=(.)\r?\n/i.exec(text);
  if (sep && (DELIMITERS as readonly string[]).includes(sep[1]!)) return sep[1] as Delimiter;
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted) {
      if (ch === "\n" || ch === "\r") break;
      if (ch in counts) counts[ch]! += 1;
    }
  }
  let best: Delimiter = ",";
  for (const d of DELIMITERS) if (counts[d]! > counts[best]!) best = d;
  return best;
}

function checkRowShape(row: string[]) {
  if (row.length > IMPORT_LIMITS.maxColumns) throw new ImportFileError("too_many_columns");
  for (const cell of row) {
    if (cell.length > IMPORT_LIMITS.maxCellLength) throw new ImportFileError("cell_too_long");
  }
}

/**
 * RFC 4180 CSV: quoted fields with embedded delimiters, quotes (`""`) and line breaks, CRLF/LF/CR.
 * Completely empty records are skipped but still counted in `numbers`, so an error message names
 * the record the user sees in the file. Throws `ImportFileError` on a violated limit or an
 * unterminated quote.
 */
export function parseCsv(text: string, delimiter?: Delimiter): ParsedTable {
  let source = text.startsWith("﻿") ? text.slice(1) : text;
  const d = delimiter ?? detectDelimiter(source);
  source = source.replace(/^sep=.\r?\n/i, "");

  const rows: string[][] = [];
  const numbers: number[] = [];
  let record = 0;
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let touched = false; // the current record has any character

  const endCell = () => {
    row.push(cell);
    cell = "";
  };
  const endRecord = () => {
    record += 1;
    if (touched) {
      endCell();
      const blank = row.every((c) => c.trim() === "");
      if (!blank) {
        checkRowShape(row);
        rows.push(row);
        numbers.push(record);
        if (rows.length > IMPORT_LIMITS.maxRows + 1) throw new ImportFileError("too_many_rows");
      }
    }
    row = [];
    cell = "";
    touched = false;
  };

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      if (cell.length > IMPORT_LIMITS.maxCellLength) throw new ImportFileError("cell_too_long");
      continue;
    }
    if (ch === '"' && cell === "") {
      inQuotes = true;
      touched = true;
    } else if (ch === d) {
      touched = true;
      endCell();
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && source[i + 1] === "\n") i += 1;
      endRecord();
    } else {
      touched = true;
      cell += ch;
      if (cell.length > IMPORT_LIMITS.maxCellLength) throw new ImportFileError("cell_too_long");
    }
  }
  if (inQuotes) throw new ImportFileError("bad_csv");
  if (touched) endRecord();
  return { rows, numbers };
}

/**
 * Looks at the zip directory of an XLSX file before anything is inflated: entry count and the
 * uncompressed sizes the directory declares must stay within the limits (zip bomb), ZIP64 and
 * encrypted archives are refused. A directory that lies about sizes is not caught here; the XLSX
 * reader additionally stops after the row limit.
 */
export function inspectZip(bytes: Uint8Array): { entries: number; uncompressedBytes: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 22) throw new ImportFileError("bad_xlsx");
  let eocd = -1;
  const lowest = Math.max(0, bytes.byteLength - 22 - 0xffff);
  for (let i = bytes.byteLength - 22; i >= lowest; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ImportFileError("bad_xlsx");
  const entries = view.getUint16(eocd + 10, true);
  const dirSize = view.getUint32(eocd + 12, true);
  const dirOffset = view.getUint32(eocd + 16, true);
  if (entries === 0xffff || dirSize === 0xffffffff || dirOffset === 0xffffffff) {
    throw new ImportFileError("bad_xlsx"); // ZIP64
  }
  if (entries > IMPORT_LIMITS.maxZipEntries) throw new ImportFileError("zip_bomb");
  if (dirOffset + dirSize > bytes.byteLength) throw new ImportFileError("bad_xlsx");

  let pos = dirOffset;
  let total = 0;
  for (let n = 0; n < entries; n += 1) {
    if (pos + 46 > bytes.byteLength || view.getUint32(pos, true) !== 0x02014b50) {
      throw new ImportFileError("bad_xlsx");
    }
    const flags = view.getUint16(pos + 8, true);
    if (flags & 1) throw new ImportFileError("bad_xlsx"); // encrypted
    const uncompressed = view.getUint32(pos + 24, true);
    if (uncompressed === 0xffffffff) throw new ImportFileError("bad_xlsx");
    total += uncompressed;
    if (total > IMPORT_LIMITS.maxZipUncompressedBytes) throw new ImportFileError("zip_bomb");
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return { entries, uncompressedBytes: total };
}
