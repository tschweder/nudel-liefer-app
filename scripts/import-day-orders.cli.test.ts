import { describe, expect, it } from "vitest";

import { type DayImportPlan, parseCliArgs, renderPlan } from "./import-day-orders";

describe("parseCliArgs", () => {
  it("reads the file, flags and values (also --key=value)", () => {
    expect(
      parseCliArgs([
        "tag.csv",
        "--date",
        "2026-10-27",
        "--apply",
        "--skip-errors",
        "--replace-notes",
        "--actor=a@b.c",
        "--resume",
        "--translate-now",
      ]),
    ).toMatchObject({
      file: "tag.csv",
      date: "2026-10-27",
      apply: true,
      skipErrors: true,
      replaceNotes: true,
      resume: true,
      translateNow: true,
      actor: "a@b.c",
      unknown: [],
    });
  });
  it("is a dry run unless --apply is given", () => {
    const args = parseCliArgs(["tag.csv"]);
    expect(args).toMatchObject({
      apply: false,
      skipErrors: false,
      replaceNotes: false,
      resume: false,
    });
  });
  it("collects unknown flags, a second file and missing values", () => {
    expect(parseCliArgs(["a.csv", "b.csv", "--nope", "--date"]).unknown).toEqual([
      "b.csv",
      "--nope",
      "--date (value missing)",
    ]);
    expect(parseCliArgs([]).file).toBeNull();
    expect(parseCliArgs(["--help"]).help).toBe(true);
  });
});

describe("renderPlan", () => {
  const plan: DayImportPlan = {
    sha256: "f".repeat(64),
    date: "2026-10-27",
    actor: { id: "u1", email: "admin@example.com" },
    skippedBlank: 1,
    replaceNotes: false,
    importedRows: [],
    rows: [
      {
        row: 2,
        customerNumber: "1006",
        status: "ok",
        customer: { id: "c1", name: "Trattoria Rossi", city: "Wien" },
        sku: "NUDELN-KARTON",
        product: "Karton 10 kg",
        productId: "p1",
        quantity: 3,
        note: "R · 35 €",
        noteAction: "set",
        alreadyImported: false,
        warnings: ["no_navigation"],
        existingConfirmed: 0,
      },
      {
        row: 3,
        customerNumber: "x",
        status: "error",
        error: "Unknown customerNumber x",
        note: "",
        noteAction: null,
        alreadyImported: false,
        warnings: [],
        existingConfirmed: 0,
      },
    ],
  };
  it("shows the row, the customer, the product, the note action, errors, warnings and totals", () => {
    const text = renderPlan(plan).join("\n");
    expect(text).toContain("Trattoria Rossi");
    expect(text).toContain("Karton 10 kg");
    expect(text).toContain("set");
    expect(text).toContain("ERROR: Unknown customerNumber x");
    expect(text).toContain("no navigation button until geocoded");
    expect(text).toContain("Would create:  1 confirmed orders for 1 customers");
    expect(text).toContain("1 blank rows ignored");
    expect(text).toContain("admin@example.com");
  });
});
