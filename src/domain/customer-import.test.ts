import { describe, expect, it } from "vitest";

import {
  buildRecords,
  checkMapping,
  cleanCell,
  type ColumnMapping,
  type ExistingCustomer,
  looksLikeFormula,
  numberKey,
  padPostalCode,
  parseCountry,
  planImport,
  rememberMapping,
  suggestMapping,
  summarizePlan,
  validateRecord,
} from "./customer-import";
import { parseCsv } from "./import-file";
import {
  customerImportRows,
  FIXTURE_HEADER_DE,
  FIXTURE_INVALID_INDEXES,
  toCsv,
} from "./testing/import-fixtures";

const existing = (list: ExistingCustomer[]) =>
  new Map(list.map((c) => [numberKey(c.customerNumber), c]));

const stored: ExistingCustomer = {
  id: "c1",
  customerNumber: "K-0001",
  name: "Gasthaus Alt",
  street: "Hauptstraße 1",
  postalCode: "1010",
  city: "Wien",
  country: "AT",
  deliveryHoursInfo: "Mo-Fr 6-10",
  notes: "Hof",
  companyName: null,
  vatId: null,
  billingStreet: null,
  billingPostalCode: null,
  billingCity: null,
  active: true,
};

const row = (over: Record<string, string> = {}) => ({
  customerNumber: "K-0001",
  name: "Gasthaus Alt",
  street: "Hauptstraße 1",
  postalCode: "1010",
  city: "Wien",
  ...over,
});

describe("suggestMapping", () => {
  it("recognises German headers", () => {
    expect(suggestMapping([...FIXTURE_HEADER_DE])).toEqual({
      customerNumber: 0,
      name: 1,
      street: 2,
      postalCode: 3,
      city: 4,
      country: 5,
      deliveryHoursInfo: 6,
      notes: 7,
    });
  });

  it("recognises English and Chinese headers, ignores unknown columns", () => {
    expect(suggestMapping(["Customer No", "Company", "Street", "ZIP", "City", "x"])).toMatchObject({
      name: 1,
      street: 2,
      postalCode: 3,
      city: 4,
    });
    expect(suggestMapping(["客户编号", "客户名称", "地址", "邮编", "城市"])).toEqual({
      customerNumber: 0,
      name: 1,
      street: 2,
      postalCode: 3,
      city: 4,
    });
  });

  it("prefers the remembered mapping and uses a column only once", () => {
    const m = suggestMapping(["Firma", "Anschrift", "Ort", "Nr", "Code"], {
      street: "Anschrift",
      customerNumber: "Code",
      name: "Firma",
    });
    expect(m.customerNumber).toBe(4);
    expect(m.street).toBe(1);
    expect(m.name).toBe(0);
    expect(new Set(Object.values(m)).size).toBe(Object.values(m).length);
  });

  it("round-trips through rememberMapping", () => {
    const headers = ["A", "B", "C"];
    const mapping: ColumnMapping = { customerNumber: 2, name: 0 };
    expect(rememberMapping(headers, mapping)).toEqual({ customerNumber: "C", name: "A" });
  });
});

describe("checkMapping", () => {
  it("requires number, name, street, postal code and city", () => {
    expect(
      checkMapping({ customerNumber: 0 }).map((p) => (p.code === "missing" ? p.field : "")),
    ).toEqual(["name", "street", "postalCode", "city"]);
  });

  it("rejects a column that feeds two fields", () => {
    const problems = checkMapping({
      customerNumber: 0,
      name: 0,
      street: 1,
      postalCode: 2,
      city: 3,
    });
    expect(problems).toEqual([{ code: "duplicate_column", column: 0 }]);
  });
});

describe("cleaning", () => {
  it("normalizes Unicode, removes invisible characters and collapses whitespace", () => {
    expect(cleanCell("  Müller ​ Gasthaus  ")).toBe("Müller Gasthaus");
    expect(cleanCell("a\r\nb\tc")).toBe("a b c");
    expect(cleanCell("Zeile 1 \r\n\r\n\r\n\r\nZeile 2", true)).toBe("Zeile 1\n\nZeile 2");
  });

  it("flags text a spreadsheet would execute as a formula", () => {
    for (const bad of [
      "=1+1",
      "@SUM(A1)",
      "+cmd|' /C calc'!A0",
      "-2+3x",
      "\t=1",
      "\r1",
      "  =A1",
      "-Bäcker",
    ]) {
      expect(looksLikeFormula(bad), bad).toBe(true);
    }
    for (const fine of ["+43 1 234", "-", "- Hof", "Müller", "(=)", "1-2", "龙门", "-5"]) {
      expect(looksLikeFormula(fine), fine).toBe(false);
    }
  });

  it("understands country codes and names", () => {
    expect(parseCountry("at")).toBe("AT");
    expect(parseCountry("Österreich")).toBe("AT");
    expect(parseCountry("Germany")).toBe("DE");
    expect(parseCountry("德国")).toBe("DE");
    expect(parseCountry("Atlantis")).toBeNull();
  });

  it("restores the leading zero of German postal codes only", () => {
    expect(padPostalCode("1067", "DE")).toBe("01067");
    expect(padPostalCode("01067", "DE")).toBe("01067");
    expect(padPostalCode("1010", "AT")).toBe("1010");
    expect(padPostalCode("12345", "DE")).toBe("12345");
  });
});

describe("validateRecord", () => {
  it("accepts a clean row and reports every problem of a bad one", () => {
    expect(validateRecord(row({ country: "", deliveryHoursInfo: "", notes: "" }))).toMatchObject({
      ok: true,
      value: { customerNumber: "K-0001", country: null, deliveryHoursInfo: null, notes: null },
    });
    const bad = validateRecord(
      row({ name: "", street: "=cmd", city: "x".repeat(101), country: "Mars" }),
    );
    expect(bad).toEqual({
      ok: false,
      issues: [
        { code: "required", field: "name" },
        { code: "formula", field: "street" },
        { code: "too_long", field: "city", max: 100 },
        { code: "bad_country", field: "country" },
      ],
    });
  });

  it("repairs spreadsheet float artefacts in numbers and postal codes", () => {
    const r = validateRecord(row({ customerNumber: " 1001.0 ", postalCode: "1010,00" }));
    expect(r).toMatchObject({ ok: true, value: { customerNumber: "1001", postalCode: "1010" } });
  });

  it("keeps German and Chinese text intact", () => {
    const r = validateRecord(row({ name: "龙门饭店 · Zum Löwen", city: "St. Pölten" }));
    expect(r).toMatchObject({
      ok: true,
      value: { name: "龙门饭店 · Zum Löwen", city: "St. Pölten" },
    });
  });
});

describe("planImport", () => {
  const plan = (rows: Array<Record<string, string>>, list: ExistingCustomer[] = []) =>
    planImport(
      rows.map((record, i) => ({ line: i + 2, record })),
      existing(list),
    );

  it("creates unknown customers", () => {
    const [p] = plan([row({ customerNumber: "K-9", country: "" })]);
    expect(p).toMatchObject({ status: "create", create: { country: "AT", customerNumber: "K-9" } });
  });

  it("matches by number case-insensitively and keeps the stored spelling", () => {
    const [p] = plan([row({ customerNumber: "k-0001", name: "Gasthaus Neu" })], [stored]);
    expect(p).toMatchObject({
      status: "update",
      existingId: "c1",
      changedFields: ["name"],
      pinReset: false,
    });
    expect(p!.patch).toEqual({ name: "Gasthaus Neu" });
  });

  it("is unchanged when nothing differs, even with empty optional cells", () => {
    const [p] = plan([row({ country: "", deliveryHoursInfo: "", notes: "" })], [stored]);
    expect(p).toMatchObject({ status: "unchanged", changedFields: [], pinReset: false });
  });

  it("resets the pin only when the address changed", () => {
    const [street] = plan([row({ street: "Neue Gasse 5" })], [stored]);
    expect(street).toMatchObject({ status: "update", pinReset: true });
    const [sameAddressOtherCase] = plan(
      [row({ street: "HAUPTSTRASSE 1".replace("SS", "ß") })],
      [stored],
    );
    expect(sameAddressOtherCase!.pinReset).toBe(false);
    const [country] = plan([row({ country: "DE" })], [stored]);
    expect(country).toMatchObject({
      pinReset: true,
      changedFields: expect.arrayContaining(["country"]),
    });
  });

  it("marks updates of archived customers; they stay archived", () => {
    const [p] = plan([row({ name: "Neu" })], [{ ...stored, active: false }]);
    expect(p).toMatchObject({ status: "update", archived: true });
  });

  it("reports a number twice in the file on the later row", () => {
    const plans = plan([row(), row({ customerNumber: "K-0001".toLowerCase(), name: "Zweiter" })]);
    expect(plans[0]!.status).toBe("create");
    expect(plans[1]).toMatchObject({
      status: "error",
      issues: [{ code: "duplicate_in_file", field: "customerNumber", line: 2 }],
    });
  });

  it("pads a German postal code and says so", () => {
    const [p] = plan([row({ customerNumber: "D1", postalCode: "1067", country: "DE" })]);
    expect(p!.create!.postalCode).toBe("01067");
    expect(p!.warnings).toEqual([{ code: "postal_padded", field: "postalCode" }]);
  });

  it("uses the stored country for the padding when the cell is empty", () => {
    const [p] = plan(
      [row({ postalCode: "1067", country: "" })],
      [{ ...stored, country: "DE", postalCode: "01067" }],
    );
    expect(p).toMatchObject({ status: "unchanged" });
  });
});

describe("150-row fixture", () => {
  const table = parseCsv(toCsv(customerImportRows()));
  const mapping = suggestMapping(table.rows[0]!);
  const records = buildRecords(table, mapping);

  it("is read as 150 rows from a ';' file with BOM", () => {
    expect(checkMapping(mapping)).toEqual([]);
    expect(records).toHaveLength(150);
  });

  it("imports 147 and reports the 3 invalid rows with reasons and file rows", () => {
    const plan = planImport(records, existing([]));
    expect(summarizePlan(plan)).toEqual({ create: 147, update: 0, unchanged: 0, error: 3 });
    const errors = plan.filter((p) => p.status === "error");
    expect(errors.map((e) => e.line)).toEqual(FIXTURE_INVALID_INDEXES.map((i) => i + 2));
    expect(errors.map((e) => e.issues[0])).toEqual([
      { code: "required", field: "postalCode" },
      { code: "formula", field: "name" },
      { code: "bad_country", field: "country" },
    ]);
  });

  it("re-importing the same file updates instead of duplicating", () => {
    const first = planImport(records, existing([]));
    const stored = first
      .filter((p) => p.create)
      .map((p, i): ExistingCustomer => ({
        id: `id${i}`,
        customerNumber: p.create!.customerNumber,
        name: p.create!.name,
        street: p.create!.street,
        postalCode: p.create!.postalCode,
        city: p.create!.city,
        country: p.create!.country,
        deliveryHoursInfo: p.create!.deliveryHoursInfo,
        notes: p.create!.notes ?? "",
        companyName: p.create!.companyName,
        vatId: p.create!.vatId,
        billingStreet: p.create!.billingStreet,
        billingPostalCode: p.create!.billingPostalCode,
        billingCity: p.create!.billingCity,
        active: true,
      }));
    const second = planImport(records, existing(stored));
    expect(summarizePlan(second)).toEqual({ create: 0, update: 0, unchanged: 147, error: 3 });
  });

  it("keeps leading zeros and umlauts of the file", () => {
    const plan = planImport(records, existing([]));
    const dresden = plan.find((p) => p.create?.city === "Dresden");
    expect(dresden!.create!.postalCode).toBe("01067");
    expect(plan.some((p) => p.create?.name.startsWith("龙门饭店"))).toBe(true);
    expect(plan.some((p) => p.create?.name.includes("Löwen"))).toBe(true);
  });
});
