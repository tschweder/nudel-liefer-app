import ExcelJS from "exceljs";

import { IMPORT_LIMITS, ImportFileError, inspectZip, type ParsedTable } from "@/domain/import-file";

export type XlsxTable = ParsedTable & { sheetName: string; sheetCount: number };

type CellLike = { value: ExcelJS.CellValue; numFmt?: string };

/** "00000"-style number formats: spreadsheets store 1067 but show 01067. */
function zeroPad(numFmt: string | undefined): number {
  const match = /^(0+)$/.exec((numFmt ?? "").replace(/\[\$[^\]]*\]/g, ""));
  return match ? match[1]!.length : 0;
}

/** The text of a cell as the user sees it (numbers keep their zero padding, formulas give their result). */
export function cellText(cell: CellLike): string {
  let value: ExcelJS.CellValue = cell.value;
  if (value !== null && typeof value === "object" && "result" in value) {
    value = (value as { result?: ExcelJS.CellValue }).result ?? null; // formula: cached result
  }
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") {
    const text = Number.isInteger(value) ? value.toFixed(0) : String(value);
    return text.padStart(zeroPad(cell.numFmt), "0");
  }
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("richText" in value) return value.richText.map((run) => run.text).join("");
    if ("text" in value) {
      const inner = (value as { text: unknown }).text;
      return typeof inner === "string" ? inner : "";
    }
    // Error values (#N/A) carry no usable text.
  }
  return "";
}

/**
 * Reads the first non-empty worksheet of an XLSX file as text. The zip directory is inspected before
 * anything is inflated (entry count, declared sizes); then the limits for rows, columns and cell
 * length apply while reading. Only the first sheet is used; the caller is told how many exist.
 */
export async function readXlsx(bytes: Uint8Array): Promise<XlsxTable> {
  inspectZip(bytes);
  const workbook = new ExcelJS.Workbook();
  try {
    // Copy into a Node Buffer; exceljs rejects plain typed arrays of other realms.
    await workbook.xlsx.load(Buffer.from(bytes) as unknown as ExcelJS.Buffer);
  } catch {
    throw new ImportFileError("bad_xlsx");
  }
  const sheets = workbook.worksheets;
  for (const sheet of sheets) {
    const rows: string[][] = [];
    const numbers: number[] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      let last = 0;
      const cells: string[] = [];
      row.eachCell({ includeEmpty: false }, (cell, column) => {
        const text = cellText(cell);
        if (text.trim() === "") return;
        if (column > IMPORT_LIMITS.maxColumns) throw new ImportFileError("too_many_columns");
        if (text.length > IMPORT_LIMITS.maxCellLength) throw new ImportFileError("cell_too_long");
        cells[column - 1] = text;
        last = Math.max(last, column);
      });
      if (last === 0) return;
      rows.push(Array.from({ length: last }, (_, i) => cells[i] ?? ""));
      numbers.push(row.number);
      if (rows.length > IMPORT_LIMITS.maxRows + 1) throw new ImportFileError("too_many_rows");
    });
    if (rows.length > 0) return { rows, numbers, sheetName: sheet.name, sheetCount: sheets.length };
  }
  return { rows: [], numbers: [], sheetName: sheets[0]?.name ?? "", sheetCount: sheets.length };
}
