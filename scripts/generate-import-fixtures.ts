/**
 * Writes the generated, fictional import fixtures to `tests/fixtures/` (NUD-090):
 * `customers-150.csv` (';' delimited, UTF-8 with BOM, 150 rows of which 3 are invalid) and
 * `customers-150.xlsx` (same data, postal codes as numbers with a zero-padded format).
 * Run `pnpm exec tsx scripts/generate-import-fixtures.ts` after changing the fixture data.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import ExcelJS from "exceljs";

import { customerImportRows, toCsv } from "../src/domain/testing/import-fixtures";

const dir = path.join(process.cwd(), "tests", "fixtures");

export function fixtureCsv(): string {
  return toCsv(customerImportRows(), { delimiter: ";", bom: true, eol: "\r\n" });
}

export async function fixtureXlsx(): Promise<Uint8Array> {
  const rows = customerImportRows();
  const wb = new ExcelJS.Workbook();
  wb.created = new Date("2026-01-01T00:00:00Z");
  wb.modified = wb.created;
  const ws = wb.addWorksheet("Kunden");
  rows.forEach((row, index) => {
    const added = ws.addRow(row);
    // A postal code like "01067" in a numeric cell with format 00000 (what Excel users often have).
    const postal = row[3] ?? "";
    if (index > 0 && /^\d{5}$/.test(postal)) {
      const cell = added.getCell(4);
      cell.value = Number(postal);
      cell.numFmt = "00000";
    }
  });
  return new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

async function main() {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "customers-150.csv"), fixtureCsv());
  writeFileSync(path.join(dir, "customers-150.xlsx"), await fixtureXlsx());
  console.log(`wrote ${dir}/customers-150.csv and customers-150.xlsx`);
}

if (process.argv[1] && path.basename(process.argv[1]) === "generate-import-fixtures.ts") {
  void main();
}
