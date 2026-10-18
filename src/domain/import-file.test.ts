import { describe, expect, it } from "vitest";

import {
  decodeText,
  detectDelimiter,
  detectFileKind,
  IMPORT_LIMITS,
  ImportFileError,
  inspectZip,
  parseCsv,
} from "./import-file";

const bytes = (s: string) => new TextEncoder().encode(s);

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof ImportFileError ? error.code : "other";
  }
  return undefined;
}

describe("decodeText", () => {
  it("removes a UTF-8 BOM and keeps German and Chinese text", () => {
    const raw = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes("Müller 龙门")]);
    expect(decodeText(raw)).toBe("Müller 龙门");
  });

  it("reads UTF-16 with BOM (Excel 'Unicode text')", () => {
    const text = "Name\tStraße";
    const le = new Uint8Array(2 + text.length * 2);
    le.set([0xff, 0xfe]);
    for (let i = 0; i < text.length; i += 1) {
      le[2 + i * 2] = text.charCodeAt(i) & 0xff;
      le[3 + i * 2] = text.charCodeAt(i) >> 8;
    }
    expect(decodeText(le)).toBe(text);
  });

  it("falls back to windows-1252 for old German Excel files", () => {
    // "Bäckerei Größe" in cp1252: ä = E4, ö = F6, ß = DF
    const cp = new Uint8Array([
      0x42, 0xe4, 0x63, 0x6b, 0x65, 0x72, 0x65, 0x69, 0x20, 0x47, 0x72, 0xf6, 0xdf, 0x65,
    ]);
    expect(decodeText(cp)).toBe("Bäckerei Größe");
  });
});

describe("detectDelimiter", () => {
  it("picks the most frequent delimiter of the header line", () => {
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(detectDelimiter("a,b,c\n1,2,3")).toBe(",");
    expect(detectDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t");
    expect(detectDelimiter("single\n1")).toBe(",");
  });

  it("ignores delimiters inside quotes and honours an Excel sep= line", () => {
    expect(detectDelimiter('"a,b,c,d";e;f')).toBe(";");
    expect(detectDelimiter("sep=|\na|b")).toBe(",");
    expect(detectDelimiter("sep=;\na,b,c,d")).toBe(";");
  });
});

describe("parseCsv", () => {
  it("parses ';' files with BOM, CRLF, quotes and line breaks inside cells", () => {
    const text = '﻿Nr;Name;Hinweis\r\n1;"Zum ""Löwen""";"Zeile 1\nZeile 2"\r\n2;龙门;\r\n';
    const { rows, numbers } = parseCsv(text);
    expect(rows).toEqual([
      ["Nr", "Name", "Hinweis"],
      ["1", 'Zum "Löwen"', "Zeile 1\nZeile 2"],
      ["2", "龙门", ""],
    ]);
    expect(numbers).toEqual([1, 2, 3]);
  });

  it("skips empty records but keeps the record numbers of the file", () => {
    const { rows, numbers } = parseCsv("a,b\n\n1,2\n,\n3,4");
    expect(rows).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
    expect(numbers).toEqual([1, 3, 5]);
  });

  it("keeps leading zeros (text, never numbers)", () => {
    expect(parseCsv("PLZ\n01067").rows[1]).toEqual(["01067"]);
  });

  it("rejects an unterminated quote", () => {
    expect(code(() => parseCsv('a,b\n"open,1'))).toBe("bad_csv");
  });

  it("enforces the row, column and cell limits", () => {
    const many = ["h", ...Array.from({ length: IMPORT_LIMITS.maxRows + 1 }, (_, i) => String(i))];
    expect(code(() => parseCsv(many.join("\n")))).toBe("too_many_rows");
    const ok = ["h", ...Array.from({ length: IMPORT_LIMITS.maxRows }, (_, i) => String(i))];
    expect(parseCsv(ok.join("\n")).rows).toHaveLength(IMPORT_LIMITS.maxRows + 1);
    expect(
      code(() =>
        parseCsv(
          Array(IMPORT_LIMITS.maxColumns + 1)
            .fill("x")
            .join(","),
        ),
      ),
    ).toBe("too_many_columns");
    expect(code(() => parseCsv(`a\n${"x".repeat(IMPORT_LIMITS.maxCellLength + 1)}`))).toBe(
      "cell_too_long",
    );
    expect(code(() => parseCsv(`a\n"${"x".repeat(IMPORT_LIMITS.maxCellLength + 1)}"`))).toBe(
      "cell_too_long",
    );
  });
});

describe("detectFileKind", () => {
  it("uses the zip signature, then the extension", () => {
    expect(detectFileKind(new Uint8Array([0x50, 0x4b, 3, 4]), "x.bin")).toBe("xlsx");
    expect(detectFileKind(bytes("a,b"), "kunden.CSV")).toBe("csv");
    expect(detectFileKind(bytes("a,b"), "kunden.txt")).toBe("csv");
    expect(detectFileKind(bytes("not a zip"), "kunden.xlsx")).toBeNull();
    expect(detectFileKind(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]), "alt.xls")).toBeNull();
    expect(detectFileKind(bytes("<html>"), "x.html")).toBeNull();
  });
});

/** A minimal zip with one stored entry; `declared` overrides the uncompressed size in the directory. */
function tinyZip(declared?: number, extraEntries = 0): Uint8Array {
  const name = bytes("a.txt");
  const entries = 1 + extraEntries;
  const local = new Uint8Array(30 + name.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  local.set(name, 30);
  lv.setUint16(26, name.length, true);
  const dirEntry = new Uint8Array(46 + name.length);
  const dv = new DataView(dirEntry.buffer);
  dv.setUint32(0, 0x02014b50, true);
  dv.setUint32(24, declared ?? 0, true);
  dv.setUint16(28, name.length, true);
  dirEntry.set(name, 46);
  const dir = new Uint8Array(dirEntry.length * entries);
  for (let i = 0; i < entries; i += 1) dir.set(dirEntry, i * dirEntry.length);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries, true);
  ev.setUint16(10, entries, true);
  ev.setUint32(12, dir.length, true);
  ev.setUint32(16, local.length, true);
  const out = new Uint8Array(local.length + dir.length + end.length);
  out.set(local, 0);
  out.set(dir, local.length);
  out.set(end, local.length + dir.length);
  return out;
}

describe("inspectZip", () => {
  it("accepts a small archive", () => {
    expect(inspectZip(tinyZip(100))).toEqual({ entries: 1, uncompressedBytes: 100 });
  });

  it("refuses a declared uncompressed size above the limit (zip bomb)", () => {
    expect(code(() => inspectZip(tinyZip(IMPORT_LIMITS.maxZipUncompressedBytes + 1)))).toBe(
      "zip_bomb",
    );
  });

  it("refuses too many entries", () => {
    expect(code(() => inspectZip(tinyZip(1, IMPORT_LIMITS.maxZipEntries)))).toBe("zip_bomb");
  });

  it("refuses data that is not a zip directory", () => {
    expect(code(() => inspectZip(bytes("PK\u0003\u0004 definitely not a complete zip file")))).toBe(
      "bad_xlsx",
    );
    expect(code(() => inspectZip(new Uint8Array(5)))).toBe("bad_xlsx");
  });
});
