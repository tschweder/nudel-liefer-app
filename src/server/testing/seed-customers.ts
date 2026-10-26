import type { PrismaClient } from "@/generated/prisma/client";

/** Name/street/city parts with accents and umlauts on purpose (search tests). */
const NAME_A = [
  "Gasthaus",
  "Pizzeria",
  "Café",
  "Restaurant",
  "Trattoria",
  "Bäckerei",
  "Ristorante",
];
const NAME_B = [
  "Müller",
  "Zum Löwen",
  "Bella Vista",
  "Österreicher",
  "Šarić",
  "Da Mario",
  "Großmann",
];
const STREETS = [
  "Hauptstraße",
  "Bahnhofstraße",
  "Schönbrunner Straße",
  "Gartengasse",
  "Äußere Ring",
];
const CITIES = ["Wien", "Graz", "Linz", "Salzburg", "Innsbruck", "Klagenfurt", "St. Pölten"];

export type SeedCustomersOptions = {
  count: number;
  /** Prefix of the generated customer numbers (default "T-"). */
  prefix?: string;
  /** User that "uploaded" the generated photos (required for photo rows). */
  uploadedById?: string;
};

/**
 * Test helper (NOT part of the default seed): inserts `count` deterministic customers.
 * Mix per index i: i % 3 === 0 no Parkplatz (the others get one, needs `uploadedById`); i % 7 === 0 archived; photos: i % 4 = 0 none,
 * 1 store only, 2 parking only, 3 both. Photos need `uploadedById`.
 */
export async function seedTestCustomers(db: PrismaClient, options: SeedCustomersOptions) {
  const prefix = options.prefix ?? "T-";
  const customers = Array.from({ length: options.count }, (_, i) => ({
    customerNumber: `${prefix}${String(i + 1).padStart(4, "0")}`,
    name: `${NAME_A[i % NAME_A.length]} ${NAME_B[(i * 3) % NAME_B.length]} ${i + 1}`,
    street: `${STREETS[i % STREETS.length]} ${(i % 80) + 1}`,
    postalCode: String(1000 + ((i * 13) % 9000)),
    city: CITIES[i % CITIES.length]!,
    lat: 48 + (i % 100) / 100,
    lng: 14 + (i % 100) / 100,
    active: i % 7 !== 0,
  }));
  await db.customer.createMany({ data: customers });
  if (!options.uploadedById) return customers.length;

  const created = await db.customer.findMany({
    where: { customerNumber: { startsWith: prefix } },
    select: { id: true, customerNumber: true },
  });
  const index = new Map(customers.map((c, i) => [c.customerNumber, i]));
  const photos = created.flatMap((c) => {
    const i = index.get(c.customerNumber) ?? 0;
    const kinds = [[], ["STORE"], ["PARKING"], ["STORE", "PARKING"]][i % 4] as (
      "STORE" | "PARKING"
    )[];
    return kinds.map((kind) => ({
      customerId: c.id,
      kind,
      storageKey: `test/${c.id}/${kind}.jpg`,
      width: 800,
      height: 600,
      bytes: 1000,
      uploadedById: options.uploadedById!,
      isCurrent: true,
    }));
  });
  if (photos.length) await db.photo.createMany({ data: photos });
  const spots = created.flatMap((c) => {
    const i = index.get(c.customerNumber) ?? 0;
    if (i % 3 === 0) return [];
    return [
      {
        customerId: c.id,
        lat: 48 + (i % 100) / 100 + 0.001,
        lng: 14 + (i % 100) / 100 + 0.001,
        createdById: options.uploadedById!,
      },
    ];
  });
  if (spots.length) await db.parkingSpot.createMany({ data: spots });
  return customers.length;
}
