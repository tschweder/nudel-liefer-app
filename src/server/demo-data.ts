/**
 * Static data of the demo seed (`pnpm db:seed --demo`, NUD-060). All business names are invented;
 * the street addresses are real public addresses in Vienna. The coordinates are hand-picked
 * approximations of those addresses (street level, a few hundred metres at worst), good enough
 * for a demo - a real customer's pin has to be confirmed by the admin on the map (D9).
 */

export const DEMO_DEPOT = {
  depotName: "Nudelfabrik Wien (Demo)",
  depotAddress: "Absberggasse 27, 1100 Wien",
  depotLat: 48.1745,
  depotLng: 16.3935,
} as const;

/** Marker in `Order.internalNote`: tells the seed which orders it created. */
export const DEMO_ORDER_NOTE = "Demo-Daten (db:seed --demo)";

export const DEMO_CUSTOMER_PREFIX = "D-";

export type DemoNote = { de: string; hans: string };

export type DemoCustomer = {
  number: string;
  name: string;
  street: string;
  postalCode: string;
  lat: number;
  lng: number;
  hours?: string;
  note?: DemoNote;
};

export const DEMO_CUSTOMERS: readonly DemoCustomer[] = [
  {
    number: "D-001",
    name: "Trattoria Il Gelso Nero",
    street: "Linke Wienzeile 4",
    postalCode: "1060",
    lat: 48.199,
    lng: 16.3633,
    hours: "Mo-Sa 6-10 Uhr",
  },
  {
    number: "D-002",
    name: "Osteria Zum Roten Hahn",
    street: "Mariahilfer Straße 85",
    postalCode: "1060",
    lat: 48.1963,
    lng: 16.3511,
    hours: "Mo-Fr 7-11 Uhr",
    note: {
      de: "Hintereingang über den Hof, bitte klingeln.",
      hans: "请走院子里的后门，并按门铃。",
    },
  },
  {
    number: "D-003",
    name: "Ristorante La Bottega Bianca",
    street: "Kärntner Straße 51",
    postalCode: "1010",
    lat: 48.2033,
    lng: 16.3697,
    hours: "Mo-Sa 6-9 Uhr",
  },
  {
    number: "D-004",
    name: "Gasthaus Goldener Schlüssel",
    street: "Graben 21",
    postalCode: "1010",
    lat: 48.2085,
    lng: 16.3706,
    hours: "Mo-Fr 6-10 Uhr",
    note: { de: "Fußgängerzone: Lieferung nur bis 10 Uhr.", hans: "步行区：只能在10点前送货。" },
  },
  {
    number: "D-005",
    name: "Café Piccolo Mondo",
    street: "Rotenturmstraße 19",
    postalCode: "1010",
    lat: 48.2102,
    lng: 16.373,
  },
  {
    number: "D-006",
    name: "Pizzeria Da Luca e Sofia",
    street: "Schottenring 24",
    postalCode: "1010",
    lat: 48.2155,
    lng: 16.3647,
    hours: "Mo-Sa 8-12 Uhr",
  },
  {
    number: "D-007",
    name: "Bistro Zur Alten Mühle",
    street: "Josefstädter Straße 39",
    postalCode: "1080",
    lat: 48.2092,
    lng: 16.3441,
  },
  {
    number: "D-008",
    name: "Trattoria Nonna Rosa",
    street: "Alser Straße 4",
    postalCode: "1090",
    lat: 48.2147,
    lng: 16.3478,
    hours: "Di-Sa 7-11 Uhr",
  },
  {
    number: "D-009",
    name: "Restaurant Jadegarten",
    street: "Währinger Straße 20",
    postalCode: "1090",
    lat: 48.2185,
    lng: 16.36,
    hours: "täglich 8-11 Uhr",
    note: {
      de: "Ware bitte direkt in die Küche im Keller tragen.",
      hans: "请把货直接送到地下室的厨房。",
    },
  },
  {
    number: "D-010",
    name: "Ristorante Il Girasole",
    street: "Praterstraße 38",
    postalCode: "1020",
    lat: 48.2157,
    lng: 16.3856,
  },
  {
    number: "D-011",
    name: "Gasthaus Zum Schwarzen Adler",
    street: "Taborstraße 24",
    postalCode: "1020",
    lat: 48.2155,
    lng: 16.3796,
    hours: "Mo-Fr 6-10 Uhr",
  },
  {
    number: "D-012",
    name: "Pasta e Basta",
    street: "Landstraßer Hauptstraße 71",
    postalCode: "1030",
    lat: 48.2053,
    lng: 16.3935,
  },
  {
    number: "D-013",
    name: "Osteria Del Ponte",
    street: "Favoritenstraße 114",
    postalCode: "1100",
    lat: 48.1805,
    lng: 16.369,
    hours: "Mo-Sa 7-10 Uhr",
    note: { de: "Bitte die Lieferung an Herrn Rossi übergeben.", hans: "请把货交给罗西先生。" },
  },
  {
    number: "D-014",
    name: "Cucina Bella Napoli",
    street: "Meidlinger Hauptstraße 30",
    postalCode: "1120",
    lat: 48.1785,
    lng: 16.3315,
  },
  {
    number: "D-015",
    name: "Restaurant Himmelblau",
    street: "Wiedner Hauptstraße 60",
    postalCode: "1040",
    lat: 48.1925,
    lng: 16.3681,
    hours: "Mo-Fr 8-11 Uhr",
  },
  {
    number: "D-016",
    name: "Trattoria Santa Lucia",
    street: "Neubaugasse 25",
    postalCode: "1070",
    lat: 48.2025,
    lng: 16.3492,
  },
  {
    number: "D-017",
    name: "Beisl Zum Grünen Baum",
    street: "Burggasse 70",
    postalCode: "1070",
    lat: 48.205,
    lng: 16.34,
    note: { de: "Parken nur in der Ladezone vor dem Haus.", hans: "只能停在房子前面的装卸区。" },
  },
  {
    number: "D-018",
    name: "Ristorante Villa Toscana",
    street: "Ottakringer Straße 45",
    postalCode: "1160",
    lat: 48.2112,
    lng: 16.3182,
    hours: "Mo-Sa 7-10 Uhr",
  },
  {
    number: "D-019",
    name: "Gasthof Weinviertler Stube",
    street: "Hernalser Hauptstraße 55",
    postalCode: "1170",
    lat: 48.2178,
    lng: 16.3303,
  },
  {
    number: "D-020",
    name: "Mensa Pasta Fresca",
    street: "Simmeringer Hauptstraße 60",
    postalCode: "1110",
    lat: 48.1783,
    lng: 16.4027,
    hours: "Mo-Fr 6-9 Uhr",
  },
];

/**
 * The 8 demo products: the six of the base seed (`prisma/seed.ts`) plus these two, whose Hant
 * names are derived from the Simplified name with OpenCC (D15), flagged as machine-made.
 */
export const DEMO_EXTRA_PRODUCTS = [
  { sku: "RIGA-5", unit: "PACK", de: "Rigatoni 5 kg", hans: "粗通心粉 5公斤" },
  { sku: "GNOC-2", unit: "CRATE", de: "Gnocchi, Karton", hans: "土豆团子 (箱)" },
] as const;

/** SKUs of all 8 products in display order (base seed first). */
export const DEMO_PRODUCT_SKUS = [
  "SPAG-5",
  "PENN-5",
  "TAGL-3",
  "FUSI-5",
  "LASA-2",
  "RAVI-KG",
  "RIGA-5",
  "GNOC-2",
] as const;

/**
 * Deterministic order lines for the customer at `index` (0-based): 1-3 distinct products.
 * Quantities are whole numbers (D23): kilogram products 2, 5, 8 or 10, all others 1-6.
 */
export function demoOrderLines(
  index: number,
  unitOf: (sku: string) => string,
): { sku: string; quantity: number }[] {
  const count = 1 + (index % 3);
  return Array.from({ length: count }, (_, k) => {
    const sku = DEMO_PRODUCT_SKUS[(index * 3 + k * 2) % DEMO_PRODUCT_SKUS.length]!;
    const quantity =
      unitOf(sku) === "KG" ? [2, 5, 8, 10][(index + k) % 4]! : ((index + k * 2) % 6) + 1;
    return { sku, quantity };
  });
}
