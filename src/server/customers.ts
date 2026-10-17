import { z } from "zod";

import { Prisma, type PrismaClient } from "@/generated/prisma/client";

export const CUSTOMER_PAGE_SIZE = 25;
const MAX_TERMS = 8;

export const customerListInputSchema = z.object({
  /** Free text; every whitespace-separated term must match number, name, street, postal code or city. */
  q: z.string().trim().max(100).default(""),
  /** Archived = `active = false` (soft delete, backlog 4.3). */
  status: z.enum(["active", "archived", "all"]).default("active"),
  /** Only customers lacking a current STORE or a current PARKING photo. */
  photosMissing: z.boolean().default(false),
  pinUnconfirmed: z.boolean().default(false),
  page: z.number().int().min(1).max(100_000).default(1),
  pageSize: z.number().int().min(1).max(100).default(CUSTOMER_PAGE_SIZE),
});
export type CustomerListInput = z.input<typeof customerListInputSchema>;

export type CustomerListRow = {
  id: string;
  customerNumber: string;
  name: string;
  street: string;
  postalCode: string;
  city: string;
  pinConfirmed: boolean;
  active: boolean;
  photosMissing: boolean;
};

export type CustomerListResult = {
  rows: CustomerListRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

/** Escapes `\`, `%` and `_` so user input is matched literally by LIKE. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Splits a search string into at most MAX_TERMS terms. */
export function searchTerms(q: string): string[] {
  return q.split(/\s+/).filter(Boolean).slice(0, MAX_TERMS);
}

const MISSING_PHOTO = Prisma.sql`NOT (
  EXISTS (SELECT 1 FROM "Photo" p WHERE p."customerId" = c."id" AND p."kind" = 'STORE' AND p."isCurrent")
  AND EXISTS (SELECT 1 FROM "Photo" p WHERE p."customerId" = c."id" AND p."kind" = 'PARKING' AND p."isCurrent")
)`;

/**
 * Customer list with accent-insensitive search (decision log NUD-013): `Customer.searchText`
 * is folded by the SQL function `nudel_fold` (trigger-maintained) and the term is folded by the
 * same function, so "muller" finds "Müller" and "strasse" finds "Straße". Plain PostgreSQL only,
 * no extension. Not authorized by itself: callers go through `customer-queries.ts`.
 */
export async function listCustomers(
  db: PrismaClient,
  rawInput: unknown,
): Promise<CustomerListResult> {
  const input = customerListInputSchema.parse(rawInput ?? {});
  const conditions: Prisma.Sql[] = [];
  if (input.status === "active") conditions.push(Prisma.sql`c."active"`);
  if (input.status === "archived") conditions.push(Prisma.sql`NOT c."active"`);
  if (input.pinUnconfirmed) conditions.push(Prisma.sql`NOT c."pinConfirmed"`);
  if (input.photosMissing) conditions.push(MISSING_PHOTO);
  for (const term of searchTerms(input.q)) {
    conditions.push(
      Prisma.sql`c."searchText" LIKE '%' || "nudel_fold"(${escapeLike(term)}) || '%'`,
    );
  }
  const where = conditions.length
    ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`
    : Prisma.empty;

  const [rows, counted] = await Promise.all([
    db.$queryRaw<CustomerListRow[]>`
      SELECT c."id", c."customerNumber", c."name", c."street", c."postalCode", c."city",
             c."pinConfirmed", c."active", (${MISSING_PHOTO}) AS "photosMissing"
      FROM "Customer" c
      ${where}
      ORDER BY lower(c."name"), c."customerNumber"
      LIMIT ${input.pageSize} OFFSET ${(input.page - 1) * input.pageSize}`,
    db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "Customer" c ${where}`,
  ]);
  const total = Number(counted[0]?.n ?? 0);
  return {
    rows,
    total,
    page: input.page,
    pageSize: input.pageSize,
    pageCount: Math.max(1, Math.ceil(total / input.pageSize)),
  };
}
