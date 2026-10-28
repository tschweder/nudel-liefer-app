import "dotenv/config";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { createPrismaClient } from "../../src/server/db";

/**
 * Phase 1 of the parking-spot import (docs/parking-import/PLAN-AND-ORCHESTRATOR-PROMPT.md):
 * a read-only snapshot of the customer master data, so the review agents can match the
 * `2026-10` map pins against real customers without any database access of their own.
 *
 * Writes:
 *   .parking-import/customers.json        active customers with address, coordinates,
 *                                         active Parkplätze and current photos
 *   .parking-import/address-groups.json   customers grouped by normalized address; everybody
 *                                         in one group shares the same parking spot
 *
 * Read-only: it only issues `findMany` queries and never writes to the database.
 *
 * Two sources:
 *   (default)             Prisma against PARKING_IMPORT_DATABASE_URL, then BACKUP_DATABASE_URL,
 *                         then DATABASE_URL
 *   --from-dump <dir>     the JSON files `dump-customers.sh` wrote on the production server
 *                         (customers.json / parking-spots.json / photos.json). This is how the
 *                         production snapshot is taken: the server keeps its credentials, and
 *                         nothing but a set of SELECT results ever leaves it.
 *
 * Usage:
 *   pnpm parking:export-customers
 *   pnpm parking:export-customers --from-dump .parking-import/raw
 */

const OUT_DIR = path.resolve(process.cwd(), ".parking-import");

// ---------------------------------------------------------------------------------------------
// Address normalization (pure; the group key decides which customers share one parking spot)
// ---------------------------------------------------------------------------------------------

const STREET_ABBREVIATIONS: Array<[RegExp, string]> = [
  // Applied after accent folding and lower-casing, so "Straße." has already become "strasse".
  [/\bstr\b/g, "strasse"],
  [/\bg\b/g, "gasse"],
  [/\bpl\b/g, "platz"],
];

/** Accent-folded, lower-case, abbreviation-free form of a street name. */
export function normalizeStreetName(street: string): string {
  let value = street
    .normalize("NFD")
    // strip combining diacritics
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  for (const [pattern, replacement] of STREET_ABBREVIATIONS) {
    value = value.replace(pattern, replacement);
  }
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Splits the house number off the street ("Wagramer Straße 152" -> name + "152").
 * A range or a stair stays attached ("1-3", "1/5"), just without spaces.
 */
export function splitHouseNumber(street: string): { name: string; number: string } {
  // Numbered groups, not named ones: the root tsconfig targets ES2017, where named capture
  // groups are a compile error (TS1503).
  const match = street
    .trim()
    .match(/^(.*?)[\s,]*(\d+\s*[a-zA-Z]?(?:\s*[-/]\s*\d+\s*[a-zA-Z]?)*)\s*$/);
  if (!match) return { name: street.trim(), number: "" };
  const [, rawName, rawNumber] = match;
  return {
    name: (rawName ?? "").trim() || street.trim(),
    number: (rawNumber ?? "").replace(/\s+/g, "").toLowerCase(),
  };
}

/**
 * The group key: two customers with the same key sit at the same address and therefore share
 * one parking spot and its photo. The postal code is part of the key so that "Hauptstraße 5"
 * in two districts never merges.
 */
export function addressGroupKey(street: string, postalCode: string): string {
  const { name, number } = splitHouseNumber(street);
  return `${normalizeStreetName(name)}|${number}|${postalCode.trim().toLowerCase()}`;
}

// ---------------------------------------------------------------------------------------------
// Sources: Prisma, or the production dump
// ---------------------------------------------------------------------------------------------

type RawPhoto = {
  id: string;
  kind: string;
  storageKey: string;
  createdAt: Date | string;
  uploadedByName: string;
};
type RawSpot = {
  id: string;
  label: string | null;
  note: string | null;
  lat: number;
  lng: number;
  sortOrder: number;
};
type RawCustomer = {
  id: string;
  customerNumber: string;
  name: string;
  companyName: string | null;
  street: string;
  postalCode: string;
  city: string;
  country: string;
  lat: number | null;
  lng: number | null;
  parkingSpots: RawSpot[];
  photos: RawPhoto[];
};

function maskedConnection(): string {
  const url =
    process.env.PARKING_IMPORT_DATABASE_URL ??
    process.env.BACKUP_DATABASE_URL ??
    process.env.DATABASE_URL;
  if (!url) return "(none)";
  const source = process.env.PARKING_IMPORT_DATABASE_URL
    ? "PARKING_IMPORT_DATABASE_URL"
    : process.env.BACKUP_DATABASE_URL
      ? "BACKUP_DATABASE_URL"
      : "DATABASE_URL";
  try {
    const parsed = new URL(url);
    // Never print credentials or the full URL.
    return `${source} -> ${parsed.host}${parsed.pathname}`;
  } catch {
    return `${source} -> (unparsable URL)`;
  }
}

async function loadFromDump(dir: string): Promise<{ rows: RawCustomer[]; source: string }> {
  const read = async <T>(file: string): Promise<T> =>
    JSON.parse(await readFile(path.join(dir, file), "utf-8")) as T;

  const customers =
    await read<Array<Omit<RawCustomer, "parkingSpots" | "photos">>>("customers.json");
  const spots = await read<Array<RawSpot & { customerId: string }>>("parking-spots.json");
  const photos =
    await read<
      Array<Omit<RawPhoto, "uploadedByName"> & { customerId: string; uploadedBy: string }>
    >("photos.json");

  const spotsByCustomer = new Map<string, RawSpot[]>();
  for (const spot of spots) {
    const list = spotsByCustomer.get(spot.customerId) ?? [];
    // Rebuilt field by field so the dump's `customerId` does not leak into `RawSpot`.
    list.push({
      id: spot.id,
      label: spot.label,
      note: spot.note,
      lat: spot.lat,
      lng: spot.lng,
      sortOrder: spot.sortOrder,
    });
    spotsByCustomer.set(spot.customerId, list);
  }
  for (const list of spotsByCustomer.values()) {
    list.sort((a, b) => a.sortOrder - b.sortOrder);
  }
  const photosByCustomer = new Map<string, RawPhoto[]>();
  for (const photo of photos) {
    const list = photosByCustomer.get(photo.customerId) ?? [];
    list.push({
      id: photo.id,
      kind: photo.kind,
      storageKey: photo.storageKey,
      createdAt: photo.createdAt,
      uploadedByName: photo.uploadedBy,
    });
    photosByCustomer.set(photo.customerId, list);
  }

  return {
    source: `dump -> ${dir}`,
    rows: customers.map((customer) => ({
      ...customer,
      parkingSpots: spotsByCustomer.get(customer.id) ?? [],
      photos: photosByCustomer.get(customer.id) ?? [],
    })),
  };
}

async function loadFromDatabase(): Promise<{ rows: RawCustomer[]; source: string }> {
  const connection =
    process.env.PARKING_IMPORT_DATABASE_URL ??
    process.env.BACKUP_DATABASE_URL ??
    process.env.DATABASE_URL;
  if (!connection) throw new Error("No database connection configured (see the file header)");

  const prisma = createPrismaClient(connection);
  try {
    const rows = await prisma.customer.findMany({
      where: { active: true },
      orderBy: { customerNumber: "asc" },
      select: {
        id: true,
        customerNumber: true,
        name: true,
        companyName: true,
        street: true,
        postalCode: true,
        city: true,
        country: true,
        lat: true,
        lng: true,
        parkingSpots: {
          where: { active: true },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          select: { id: true, label: true, note: true, lat: true, lng: true, sortOrder: true },
        },
        photos: {
          where: { isCurrent: true },
          select: {
            id: true,
            kind: true,
            storageKey: true,
            createdAt: true,
            uploadedBy: { select: { displayName: true } },
          },
        },
      },
    });
    return {
      source: maskedConnection(),
      rows: rows.map((row) => ({
        id: row.id,
        customerNumber: row.customerNumber,
        name: row.name,
        companyName: row.companyName,
        street: row.street,
        postalCode: row.postalCode,
        city: row.city,
        country: row.country,
        lat: row.lat,
        lng: row.lng,
        parkingSpots: row.parkingSpots,
        photos: row.photos.map((photo) => ({
          id: photo.id,
          kind: photo.kind,
          storageKey: photo.storageKey,
          createdAt: photo.createdAt,
          uploadedByName: photo.uploadedBy.displayName,
        })),
      })),
    };
  } finally {
    await prisma.$disconnect();
  }
}

// ---------------------------------------------------------------------------------------------

async function main() {
  const dumpIndex = process.argv.indexOf("--from-dump");
  const { rows, source } =
    dumpIndex >= 0
      ? await loadFromDump(path.resolve(process.argv[dumpIndex + 1] ?? ""))
      : await loadFromDatabase();

  const customers = rows.map((row) => {
    const groupKey = addressGroupKey(row.street, row.postalCode);
    const photo = (kind: "STORE" | "PARKING") => {
      const hit = row.photos.find((p) => p.kind === kind);
      return hit
        ? {
            id: hit.id,
            storageKey: hit.storageKey,
            createdAt:
              hit.createdAt instanceof Date ? hit.createdAt.toISOString() : String(hit.createdAt),
            uploadedBy: hit.uploadedByName,
          }
        : null;
    };
    return {
      id: row.id,
      customerNumber: row.customerNumber,
      name: row.name,
      companyName: row.companyName,
      street: row.street,
      postalCode: row.postalCode,
      city: row.city,
      country: row.country,
      lat: row.lat,
      lng: row.lng,
      addressGroupKey: groupKey,
      addressLabel: `${row.street}, ${row.postalCode} ${row.city}`.trim(),
      parkingSpots: row.parkingSpots,
      photos: { STORE: photo("STORE"), PARKING: photo("PARKING") },
    };
  });

  // Address groups: everybody at the same normalized address shares one parking spot.
  const groups = new Map<string, typeof customers>();
  for (const customer of customers) {
    const list = groups.get(customer.addressGroupKey) ?? [];
    list.push(customer);
    groups.set(customer.addressGroupKey, list);
  }
  const addressGroups = [...groups.entries()]
    .map(([groupKey, members]) => ({
      groupKey,
      label: members[0].addressLabel,
      customerIds: members.map((m) => m.id),
      members: members.map((m) => ({
        id: m.id,
        customerNumber: m.customerNumber,
        name: m.name,
        street: m.street,
        lat: m.lat,
        lng: m.lng,
        hasParkingSpot: m.parkingSpots.length > 0,
        hasParkingPhoto: m.photos.PARKING !== null,
        hasStorePhoto: m.photos.STORE !== null,
      })),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "de"));

  await mkdir(OUT_DIR, { recursive: true });
  const generatedAt = new Date().toISOString();
  await writeFile(
    path.join(OUT_DIR, "customers.json"),
    JSON.stringify({ generatedAt, source, customers }, null, 2),
    "utf-8",
  );
  await writeFile(
    path.join(OUT_DIR, "address-groups.json"),
    JSON.stringify({ generatedAt, source, groups: addressGroups }, null, 2),
    "utf-8",
  );

  const withoutCoords = customers.filter((c) => c.lat === null || c.lng === null).length;
  const withSpot = customers.filter((c) => c.parkingSpots.length > 0).length;
  const withParkingPhoto = customers.filter((c) => c.photos.PARKING !== null).length;
  const sharedGroups = addressGroups.filter((g) => g.members.length > 1);
  console.log(`source: ${source}`);
  console.log(
    `wrote ${customers.length} active customers to ${path.join(OUT_DIR, "customers.json")}`,
  );
  console.log(
    `  without coordinates: ${withoutCoords} | with an active Parkplatz: ${withSpot} | ` +
      `with a current PARKING photo: ${withParkingPhoto}`,
  );
  console.log(
    `  address groups: ${addressGroups.length} (${sharedGroups.length} with more than one customer)`,
  );
  for (const group of sharedGroups) {
    console.log(
      `    - ${group.label}: ${group.members.length} customers ` +
        `(${group.members.map((m) => m.customerNumber).join(", ")})`,
    );
  }
}

void main();
