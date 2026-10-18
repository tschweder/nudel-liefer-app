// @vitest-environment node
import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";

import { customerImportRows, toCsv } from "@/domain/testing/import-fixtures";

import { AuthorizationError } from "./auth/actor";
import { handleParseUpload, parseImportFile } from "./customer-import-upload";

const admin = { id: "a", role: "ADMIN" as const, locale: "de", name: "A", localeChosen: true };
const allow = { requireRole: vi.fn(async () => admin) };

function upload(content: Uint8Array | string, filename: string, type = "text/csv") {
  const form = new FormData();
  form.set("file", new File([content as BlobPart], filename, { type }));
  return new Request("http://localhost/api/admin/customers/import/parse", {
    method: "POST",
    body: form,
  });
}

async function xlsx(rows: Array<Array<string | number>>, formats: Record<string, string> = {}) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Kunden");
  rows.forEach((r) => ws.addRow(r));
  for (const [address, numFmt] of Object.entries(formats)) ws.getCell(address).numFmt = numFmt;
  return new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

describe("POST parse handler", () => {
  it("rejects anonymous callers and drivers before reading the body", async () => {
    for (const [code, status] of [
      ["UNAUTHENTICATED", 401],
      ["FORBIDDEN", 403],
    ] as const) {
      const deps = {
        requireRole: vi.fn(async () => {
          throw new AuthorizationError(code);
        }),
      };
      const request = upload("a;b\n1;2", "x.csv");
      const response = await handleParseUpload(request, deps);
      expect(response.status).toBe(status);
      expect(request.bodyUsed).toBe(false);
      expect(deps.requireRole).toHaveBeenCalledWith("ADMIN");
    }
  });

  it("parses a ';' CSV with BOM, German and Chinese text", async () => {
    const response = await handleParseUpload(
      upload(toCsv(customerImportRows()), "kunden.csv"),
      allow,
    );
    expect(response.status).toBe(200);
    const { upload: parsed } = await response.json();
    expect(parsed).toMatchObject({ kind: "csv", sheetName: null, sheetCount: 1 });
    expect(parsed.table.rows).toHaveLength(151);
    expect(parsed.table.rows[0]).toEqual(customerImportRows()[0]);
    expect(parsed.table.rows[5]![1]).toBe(customerImportRows()[5]![1]);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("refuses other content types, empty and unsupported files, and oversize bodies", async () => {
    const json = new Request("http://localhost/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect((await handleParseUpload(json, allow)).status).toBe(415);
    expect((await handleParseUpload(upload("", "x.csv"), allow)).status).toBe(422);
    expect((await handleParseUpload(upload("<html>", "x.html"), allow)).status).toBe(415);
    expect((await handleParseUpload(upload("only a header", "x.csv"), allow)).status).toBe(422);
    const big = "a".repeat(5 * 1024 * 1024 + 100 * 1024);
    const response = await handleParseUpload(upload(big, "big.csv"), allow);
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "too_large" });
  });

  it("refuses a file just over 5 MB even when the framing fits", async () => {
    const response = await handleParseUpload(
      upload("a\n" + "x".repeat(5 * 1024 * 1024), "big.csv"),
      allow,
    );
    expect(response.status).toBe(413);
  });
});

describe("parseImportFile", () => {
  it("reads XLSX cells as text, keeping leading zeros of number formats", async () => {
    const bytes = await xlsx(
      [
        ["Kundennr.", "Name", "PLZ"],
        [1001, "Gasthaus Löwen 龙门", 1067],
        ["K-2", "Bistro", "01067"],
      ],
      { C2: "00000" },
    );
    const parsed = await parseImportFile(bytes, "kunden.xlsx");
    expect(parsed).toMatchObject({ kind: "xlsx", sheetName: "Kunden", sheetCount: 1 });
    expect(parsed.table.rows).toEqual([
      ["Kundennr.", "Name", "PLZ"],
      ["1001", "Gasthaus Löwen 龙门", "01067"],
      ["K-2", "Bistro", "01067"],
    ]);
    expect(parsed.table.numbers).toEqual([1, 2, 3]);
  });

  it("uses the cached result of formula cells and never the formula text", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("A");
    ws.addRow(["Nr", "Name"]);
    ws.addRow(["1", { formula: "A2&B2", result: "Ergebnis" } as ExcelJS.CellValue]);
    const bytes = new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    const parsed = await parseImportFile(bytes, "f.xlsx");
    expect(parsed.table.rows[1]).toEqual(["1", "Ergebnis"]);
  });

  it("refuses an XLSX with too many rows or columns and a file that only claims to be XLSX", async () => {
    const rows = [["h"], ...Array.from({ length: 2001 }, (_, i) => [`r${i}`])];
    await expect(parseImportFile(await xlsx(rows), "x.xlsx")).rejects.toMatchObject({
      code: "too_many_rows",
    });
    const wide = [
      Array.from({ length: 51 }, (_, i) => `c${i}`),
      Array.from({ length: 51 }, () => "v"),
    ];
    await expect(parseImportFile(await xlsx(wide), "x.xlsx")).rejects.toMatchObject({
      code: "too_many_columns",
    });
    await expect(
      parseImportFile(new TextEncoder().encode("plain text"), "fake.xlsx"),
    ).rejects.toMatchObject({ code: "unsupported_type" });
  });

  it("refuses a workbook whose zip directory declares a huge uncompressed size", async () => {
    const bytes = await xlsx([["a"], ["b"]]);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // Patch the first central-directory entry: declared uncompressed size = 4 GB - 2.
    let eocd = bytes.byteLength - 22;
    while (view.getUint32(eocd, true) !== 0x06054b50) eocd -= 1;
    const dir = view.getUint32(eocd + 16, true);
    view.setUint32(dir + 24, 0xfffffffe, true);
    await expect(parseImportFile(bytes, "bomb.xlsx")).rejects.toMatchObject({ code: "zip_bomb" });
  });

  it("refuses a truncated XLSX", async () => {
    const bytes = await xlsx([["a"], ["b"]]);
    await expect(
      parseImportFile(bytes.slice(0, bytes.length - 40), "cut.xlsx"),
    ).rejects.toMatchObject({
      code: "bad_xlsx",
    });
  });
});
