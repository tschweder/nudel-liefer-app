import { describe, expect, it } from "vitest";

import {
  combineNote,
  IMPORT_MAX_QUANTITY,
  importMarker,
  markerRow,
  parseDayCsv,
  parseImportQuantity,
  parseKarton,
  splitCsv,
} from "./import-day-orders";

const HEADER = "customerNumber;menge;Karton;notizen";

function rowsOf(text: string) {
  const parsed = parseDayCsv(text);
  if (!parsed.ok) throw new Error(parsed.fatal);
  return parsed.rows;
}

describe("splitCsv", () => {
  it("handles quotes with separators, doubled quotes and line breaks", () => {
    expect(splitCsv('a;"b;c";"d ""q"" e";"x\ny"\r\nz;;')).toEqual([
      ["a", "b;c", 'd "q" e', "x\ny"],
      ["z", "", ""],
    ]);
  });
  it("returns null for a quote that is never closed", () => {
    expect(splitCsv('a;"b')).toBeNull();
  });
});

describe("parseDayCsv", () => {
  it("reads the example rows (LF)", () => {
    const rows = rowsOf(`${HEADER}\n1006;3;ja;R · 35 €\n1049;4;nein;\n1073;6;nein;bar 6 €\n`);
    expect(rows).toEqual([
      {
        ok: true,
        row: 2,
        customerNumber: "1006",
        quantity: 3,
        karton: true,
        sku: "NUDELN-KARTON",
        note: "R · 35 €",
      },
      {
        ok: true,
        row: 3,
        customerNumber: "1049",
        quantity: 4,
        karton: false,
        sku: "NUDELN-BEUTEL",
        note: "",
      },
      {
        ok: true,
        row: 4,
        customerNumber: "1073",
        quantity: 6,
        karton: false,
        sku: "NUDELN-BEUTEL",
        note: "bar 6 €",
      },
    ]);
  });

  it("tolerates a BOM, CRLF, a missing final newline and Excel's trailing empty rows and columns", () => {
    const text = `﻿${HEADER};;\r\n1006;3;ja;R\r\n;;;\r\n\r\n1049;4;nein;;\r\n;;;`;
    const parsed = parseDayCsv(text);
    expect(parsed.ok && parsed.skippedBlank).toBe(3);
    expect(rowsOf(text).map((r) => r.row)).toEqual([2, 5]);
    expect(rowsOf(text).every((r) => r.ok)).toBe(true);
  });

  it("accepts a row without the notizen cell", () => {
    expect(rowsOf(`${HEADER}\n1049;4;nein`)[0]).toMatchObject({ ok: true, note: "" });
  });

  it("rejects a wrong header, a comma separated file and an empty file", () => {
    for (const text of [
      "",
      "\n;;\n",
      `customerNumber;menge;Karton\n1;1;ja`,
      `Kundennummer;menge;Karton;notizen\n1;1;ja;`,
      `menge;customerNumber;Karton;notizen\n1;1;ja;`,
    ]) {
      expect(parseDayCsv(text).ok, text).toBe(false);
    }
    const comma = parseDayCsv("customerNumber,menge,Karton,notizen\n1,1,ja,");
    expect(comma.ok === false && comma.fatal).toMatch(/semicolons/);
    expect(parseDayCsv(HEADER + "\n").ok).toBe(false);
  });

  it("rejects decimal commas, zero, negative numbers, text and huge quantities per row", () => {
    const rows = rowsOf(
      [
        HEADER,
        "1;2,5;ja;",
        "1;0;ja;",
        "1;-3;ja;",
        "1;drei;ja;",
        "1;3.0;ja;",
        `1;${IMPORT_MAX_QUANTITY + 1};ja;`,
        "1;1 000;ja;",
        `1;${IMPORT_MAX_QUANTITY};ja;`,
        " 1 ; 07 ;ja;",
      ].join("\n"),
    );
    expect(rows.map((r) => r.ok)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      true,
    ]);
    expect(rows[0]).toMatchObject({ ok: false, code: "quantity_invalid" });
    expect(rows[8]).toMatchObject({ ok: true, customerNumber: "1", quantity: 7 });
  });

  it("accepts ja/nein in any case and rejects anything else", () => {
    const rows = rowsOf(
      [HEADER, "1;1; JA ;", "1;1;Nein;", "1;1;nee;", "1;1;;", "1;1;true;", "1;1;1;"].join("\n"),
    );
    expect(rows.map((r) => r.ok)).toEqual([true, true, false, false, false, false]);
    expect(rows[2]).toMatchObject({ code: "karton_invalid" });
  });

  it("keeps empty and quoted notes, semicolons and line breaks inside quotes", () => {
    const rows = rowsOf(
      `${HEADER}\n1;1;ja;"R; 35 €"\n2;1;nein;""\n3;1;ja;"bar\n6 €"\n4;1;ja;"sagt ""hallo"""`,
    );
    expect(rows.map((r) => (r.ok ? r.note : null))).toEqual([
      "R; 35 €",
      "",
      "bar 6 €",
      'sagt "hallo"',
    ]);
  });

  it("reports an unquoted semicolon in a note as too many columns, a short row as too few", () => {
    const rows = rowsOf(`${HEADER}\n1;1;ja;R;35 €\n2;5\n;1;ja;`);
    expect(rows.map((r) => (r.ok ? "ok" : r.code))).toEqual([
      "too_many_columns",
      "too_few_columns",
      "customer_number_missing",
    ]);
  });

  it("keeps duplicate customers as separate rows", () => {
    const rows = rowsOf(`${HEADER}\n1006;3;ja;R\n1006;2;nein;bar 5 €`);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.ok && r.customerNumber === "1006")).toBe(true);
  });

  it("refuses notes over the customer limit per row", () => {
    expect(rowsOf(`${HEADER}\n1;1;ja;${"x".repeat(2001)}`)[0]).toMatchObject({
      code: "note_too_long",
    });
  });
});

describe("cells", () => {
  it("parseImportQuantity / parseKarton", () => {
    expect(parseImportQuantity("12")).toBe(12);
    expect(parseImportQuantity("")).toBeNull();
    expect(parseKarton("Ja")).toBe(true);
    expect(parseKarton("nein ")).toBe(false);
    expect(parseKarton("vielleicht")).toBeNull();
  });
});

describe("combineNote", () => {
  it("leaves the note alone for an empty CSV text", () => {
    expect(combineNote("alt", "  ", false)).toEqual({ action: "none", text: "alt" });
    expect(combineNote("alt", "", true)).toEqual({ action: "none", text: "alt" });
  });
  it("sets an empty note", () => {
    expect(combineNote("", "R", false)).toEqual({ action: "set", text: "R" });
  });
  it("appends with ' | ' unless the text is already contained", () => {
    expect(combineNote("Hintereingang", "R · 35 €", false)).toEqual({
      action: "append",
      text: "Hintereingang | R · 35 €",
    });
    expect(combineNote("Hintereingang | R · 35 €", "R · 35 €", false)).toEqual({
      action: "unchanged",
      text: "Hintereingang | R · 35 €",
    });
  });
  it("replaces with --replace-notes", () => {
    expect(combineNote("alt", "neu", true)).toEqual({ action: "replace", text: "neu" });
    expect(combineNote("neu", "neu", true)).toEqual({ action: "unchanged", text: "neu" });
  });
});

describe("marker", () => {
  const sha = "a".repeat(64);
  it("round trips and ignores other files, days and notes", () => {
    const marker = importMarker(sha, "2026-10-27", 7);
    expect(markerRow(sha, "2026-10-27", marker)).toBe(7);
    expect(markerRow(sha, "2026-10-28", marker)).toBeNull();
    expect(markerRow("b".repeat(64), "2026-10-27", marker)).toBeNull();
    expect(markerRow(sha, "2026-10-27", "etwas anderes")).toBeNull();
    expect(markerRow(sha, "2026-10-27", null)).toBeNull();
  });
});
