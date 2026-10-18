/**
 * Generated, fictional customer lists for the import tests (NUD-090): unit tests, integration tests,
 * the e2e test and `scripts/generate-import-fixtures.ts` all build the same data from here.
 * Deterministic (no randomness), no real businesses or addresses.
 */

export const FIXTURE_HEADER_DE = [
  "Kundennr.",
  "Name",
  "Straße",
  "PLZ",
  "Ort",
  "Land",
  "Lieferzeiten",
  "Hinweis",
] as const;

const KINDS = ["Gasthaus", "Trattoria", "Pizzeria", "Restaurant", "Bistro", "Osteria", "Café"];
const OWNERS = [
  "Zum Löwen",
  "Bella Vista",
  "Müller",
  "Grüner Baum",
  "Da Marco",
  "Sonnenschein",
  "Åkesson",
];
const CHINESE = ["龙门饭店", "金龙酒楼", "小笼包子铺", "福满楼", "老北京面馆"];
const STREETS = [
  "Hauptstraße",
  "Bahnhofstraße",
  "Lindengasse",
  "Marktplatz",
  "Schulgasse",
  "Ringstraße",
];
const AT_CITIES: Array<[string, string]> = [
  ["1010", "Wien"],
  ["1020", "Wien"],
  ["1100", "Wien"],
  ["2340", "Mödling"],
  ["3100", "St. Pölten"],
  ["2700", "Wiener Neustadt"],
];
const DE_CITIES: Array<[string, string]> = [
  ["01067", "Dresden"],
  ["04109", "Leipzig"],
  ["80331", "München"],
];

export const FIXTURE_ROW_COUNT = 150;
/** Indices (0-based among the data rows) of the three deliberately broken rows. */
export const FIXTURE_INVALID_INDEXES = [19, 76, 119] as const;

/**
 * Header plus 150 data rows; rows 20, 77 and 120 (1-based among data) are invalid. `prefix` starts
 * every customer number (the e2e tests use a unique one).
 */
export function customerImportRows(prefix = "K-"): string[][] {
  const rows: string[][] = [[...FIXTURE_HEADER_DE]];
  for (let i = 0; i < FIXTURE_ROW_COUNT; i += 1) {
    const german = i % 5 !== 4;
    const name = german
      ? `${KINDS[i % KINDS.length]} ${OWNERS[i % OWNERS.length]} ${i + 1}`
      : `${CHINESE[Math.floor(i / 5) % CHINESE.length]} ${i + 1}`;
    const de = i % 11 === 3;
    const [postal, city] = de ? DE_CITIES[i % DE_CITIES.length]! : AT_CITIES[i % AT_CITIES.length]!;
    rows.push([
      `${prefix}${String(i + 1).padStart(4, "0")}`,
      name,
      `${STREETS[i % STREETS.length]} ${(i % 40) + 1}`,
      postal,
      city,
      de ? "DE" : i % 2 === 0 ? "AT" : "",
      i % 3 === 0 ? "Mo-Fr 6-10 Uhr" : "",
      i % 7 === 0 ? "Hintereingang im Hof benutzen" : "",
    ]);
  }
  rows[1 + 19]![3] = ""; // missing postal code
  rows[1 + 76]![1] = '=HYPERLINK("http://example.invalid","Klick")'; // formula in the name
  rows[1 + 119]![5] = "Atlantis"; // unknown country
  return rows;
}

function csvCell(value: string, delimiter: string): string {
  return /["\r\n]/.test(value) || value.includes(delimiter)
    ? `"${value.replaceAll('"', '""')}"`
    : value;
}

/** CSV text; `;` and a UTF-8 BOM are what German Excel writes. */
export function toCsv(
  rows: readonly (readonly string[])[],
  options: { delimiter?: "," | ";" | "\t"; bom?: boolean; eol?: "\n" | "\r\n" } = {},
): string {
  const delimiter = options.delimiter ?? ";";
  const body = rows
    .map((row) => row.map((cell) => csvCell(cell, delimiter)).join(delimiter))
    .join(options.eol ?? "\r\n");
  return `${options.bom === false ? "" : "﻿"}${body}${options.eol ?? "\r\n"}`;
}
