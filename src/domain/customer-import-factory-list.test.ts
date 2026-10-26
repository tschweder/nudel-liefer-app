import { describe, expect, it } from "vitest";

import {
  buildRecords,
  checkMapping,
  type ExistingCustomer,
  numberKey,
  parseDeliveryAddress,
  planImport,
  suggestMapping,
  summarizePlan,
} from "./customer-import";
import { parseCsv } from "./import-file";

/** Header and rows shaped like the factory's own "Kunden.xlsx" (NUD-136), fictional data. */
const HEADER = [
  "Kundenname",
  "Firma",
  "Straße",
  "Hausnummer",
  "Ort",
  "PLZ",
  "UID",
  "LieferAdresse",
];
const FILE = [
  HEADER,
  ["099 wok", "Wok Muster GmbH", "Testgasse", "1/Top11", "Wien", "1150", "ATU 1234 5678", ""],
  ["Bipa", "Asia Bistro GmbH", "Naschmarkt", "11/Stand 87", "Wien", "1040", "", ""],
  ["U2 Kiosk", "Kiosk KG", "U2 Station Asperstraße", "", "Wien", "1220", "", ""],
  [
    "063.0 Wokhouse",
    "AWH GmbH",
    "Musterstraße",
    "135/11",
    "Wien",
    "1100",
    "ATU00000001",
    "Erzherzog Karl Straße 169",
  ],
  [
    "048.1 12edo",
    "Edo GmbH",
    "Goldschmiedgasse",
    "9/1/3a",
    "Wien",
    "1010",
    "",
    "Schönbrunnerstrasse 230/E101120 Wien",
  ],
];

const toCsv = (rows: string[][]) =>
  rows.map((r) => r.map((c) => `"${c.replaceAll('"', '""')}"`).join(",")).join("\n");

function records(rows = FILE) {
  const table = parseCsv(toCsv(rows));
  return buildRecords(table, suggestMapping(table.rows[0]!));
}

const existing = (list: ExistingCustomer[]) =>
  new Map(list.map((c) => [numberKey(c.customerNumber), c]));

const customer = (over: Partial<ExistingCustomer>): ExistingCustomer => ({
  id: "c1",
  customerNumber: "1001",
  name: "x",
  street: "s",
  postalCode: "1010",
  city: "Wien",
  country: "AT",
  deliveryHoursInfo: null,
  notes: "",
  companyName: null,
  vatId: null,
  billingStreet: null,
  billingPostalCode: null,
  billingCity: null,
  active: true,
  ...over,
});

describe("factory customer list (NUD-136)", () => {
  it("maps every column of the list, and the number is not required", () => {
    const mapping = suggestMapping(HEADER);
    expect(mapping).toEqual({
      name: 0,
      companyName: 1,
      street: 2,
      houseNumber: 3,
      city: 4,
      postalCode: 5,
      vatId: 6,
      deliveryAddress: 7,
    });
    expect(checkMapping(mapping)).toEqual([]);
  });

  it("creates every row with the next free numbers, house number and office data", () => {
    const plan = planImport(records(), existing([customer({ customerNumber: "1041" })]));
    expect(summarizePlan(plan)).toEqual({ create: 5, update: 0, unchanged: 0, error: 0 });
    expect(plan.map((p) => p.customerNumber)).toEqual(["1042", "1043", "1044", "1045", "1046"]);
    expect(plan[0]!.warnings).toContainEqual({ code: "number_assigned", field: "customerNumber" });
    expect(plan[0]!.create).toMatchObject({
      name: "099 wok",
      companyName: "Wok Muster GmbH",
      street: "Testgasse 1/Top11",
      postalCode: "1150",
      city: "Wien",
      country: "AT",
      vatId: "ATU12345678",
      billingStreet: null,
    });
    expect(plan[2]!.create!.street).toBe("U2 Station Asperstraße");
  });

  it("routes to the delivery address and keeps the address columns as billing address", () => {
    const plan = planImport(records(), existing([]));
    expect(plan[3]!.create).toMatchObject({
      street: "Erzherzog Karl Straße 169",
      postalCode: "1100",
      city: "Wien",
      billingStreet: "Musterstraße 135/11",
      billingPostalCode: "1100",
      billingCity: "Wien",
    });
    expect(plan[3]!.warnings.map((w) => w.code)).toEqual([
      "delivery_address_used",
      "delivery_postal_assumed",
      "number_assigned",
    ]);
    expect(plan[4]!.create).toMatchObject({
      street: "Schönbrunnerstrasse 230/E10",
      postalCode: "1120",
      city: "Wien",
      billingStreet: "Goldschmiedgasse 9/1/3a",
      billingPostalCode: "1010",
    });
    expect(plan[4]!.warnings.map((w) => w.code)).not.toContain("delivery_postal_assumed");
  });

  it("re-importing matches by name: unchanged, no new numbers", () => {
    const first = planImport(records(), existing([]));
    const stored = first.map((p, i) =>
      customer({ id: `id${i}`, ...p.create!, notes: p.create!.notes ?? "" }),
    );
    const second = planImport(records(), existing(stored));
    expect(summarizePlan(second)).toEqual({ create: 0, update: 0, unchanged: 5, error: 0 });
    expect(second.map((p) => p.customerNumber)).toEqual(first.map((p) => p.customerNumber));
  });

  it("a changed cell updates the customer matched by name (case-insensitive)", () => {
    const stored = [
      customer({
        id: "a",
        customerNumber: "7",
        name: "099 WOK",
        street: "Testgasse 1/Top11",
        postalCode: "1150",
      }),
    ];
    const plan = planImport(records(FILE.slice(0, 2)), existing(stored));
    expect(plan[0]).toMatchObject({ status: "update", existingId: "a", customerNumber: "7" });
    expect(plan[0]!.changedFields).toEqual(["name", "companyName", "vatId"]);
    expect(plan[0]!.pinReset).toBe(false);
  });

  it("a name two stored customers share is an error, a name twice in the file too", () => {
    const stored = [
      customer({ id: "a", customerNumber: "1", name: "Bipa" }),
      customer({ id: "b", customerNumber: "2", name: "bipa" }),
    ];
    const rows = [...FILE.slice(0, 3), FILE[1]!];
    const plan = planImport(records(rows), existing(stored));
    expect(plan[1]!.issues).toEqual([{ code: "name_ambiguous", field: "name" }]);
    expect(plan[2]!.issues).toEqual([{ code: "duplicate_in_file", field: "name", line: 2 }]);
  });

  it("assigned numbers skip numbers written further down in the file", () => {
    const rows = [
      ["Kundennummer", "Name", "Straße", "PLZ", "Ort"],
      ["", "A", "s 1", "1010", "Wien"],
      ["1001", "B", "s 2", "1010", "Wien"],
    ];
    const plan = planImport(records(rows), existing([]));
    expect(plan.map((p) => p.customerNumber)).toEqual(["1002", "1001"]);
  });
});

describe("parseDeliveryAddress", () => {
  it.each([
    ["Schönbrunnerstrasse 230/E101120 Wien", "AT", "Schönbrunnerstrasse 230/E10", "1120", "Wien"],
    ["Hauptstraße 5, 60311 Frankfurt am Main", "DE", "Hauptstraße 5", "60311", "Frankfurt am Main"],
    ["Ringstraße 3, 2351 Wiener Neudorf", "AT", "Ringstraße 3", "2351", "Wiener Neudorf"],
    ["Erzherzog Karl Straße 169", "AT", "Erzherzog Karl Straße 169", null, null],
    [
      "Handelskai 94-96EG, Millenium Towers",
      "AT",
      "Handelskai 94-96EG, Millenium Towers",
      null,
      null,
    ],
  ])("%s", (text, country, street, postalCode, city) => {
    expect(parseDeliveryAddress(text, country)).toEqual({ street, postalCode, city });
  });
});
