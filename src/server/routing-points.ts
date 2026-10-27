import type { Prisma } from "@/generated/prisma/client";

/**
 * Prisma fragments that load what `routingPoint` (src/domain/parking.ts, D22) needs: the address
 * point plus the active Parkplätze in display order. Spread into a customer `select`.
 */
export const parkingSpotsForRouting = {
  where: { active: true },
  orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  select: { sortOrder: true, active: true, lat: true, lng: true },
} satisfies Prisma.Customer$parkingSpotsArgs;

/** Same list plus the texts the driver reads next to the spot (NUD-126). */
export const parkingSpotsForDriver = {
  ...parkingSpotsForRouting,
  select: { ...parkingSpotsForRouting.select, label: true, note: true },
} satisfies Prisma.Customer$parkingSpotsArgs;

export const customerLocationSelect = {
  id: true,
  customerNumber: true,
  name: true,
  lat: true,
  lng: true,
  parkingSpots: parkingSpotsForRouting,
} satisfies Prisma.CustomerSelect;
