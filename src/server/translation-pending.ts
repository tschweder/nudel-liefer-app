import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { LocalizedText } from "@/lib/localized-text";

/**
 * Registry of the database columns that hold a `LocalizedText` which `localize()` may leave
 * with `meta.pendingTranslation = true`. The retry job walks this list; a new column that stores
 * localized user text (e.g. a future free-text field) must be added here.
 *
 * `find` returns the raw JSON (validated by the job), `save` writes the completed text back only
 * if the stored text still carries the version that was read (`meta.updatedAt`) and is still
 * pending, so an office edit between read and write is never overwritten (returns false then).
 */
export type PendingSource = {
  name: string;
  find(db: PrismaClient, limit: number): Promise<{ id: string; value: unknown }[]>;
  save(
    db: PrismaClient,
    id: string,
    previous: LocalizedText,
    next: LocalizedText,
  ): Promise<boolean>;
};

const json = (text: LocalizedText) => text as unknown as Prisma.InputJsonValue;

const stillPending = (column: "notes" | "problemNote", previous: LocalizedText) =>
  [
    { [column]: { path: ["meta", "pendingTranslation"], equals: true } },
    { [column]: { path: ["meta", "updatedAt"], equals: previous.meta.updatedAt } },
  ] as const;

export const customerNotesSource: PendingSource = {
  name: "Customer.notes",
  async find(db, limit) {
    const rows = await db.customer.findMany({
      where: { notes: { path: ["meta", "pendingTranslation"], equals: true } },
      select: { id: true, notes: true },
      orderBy: { id: "asc" },
      take: limit,
    });
    return rows.map((r) => ({ id: r.id, value: r.notes }));
  },
  async save(db, id, previous, next) {
    const { count } = await db.customer.updateMany({
      where: { id, AND: [...stillPending("notes", previous)] },
      data: { notes: json(next) },
    });
    return count === 1;
  },
};

export const stopProblemNoteSource: PendingSource = {
  name: "Stop.problemNote",
  async find(db, limit) {
    const rows = await db.stop.findMany({
      where: { problemNote: { path: ["meta", "pendingTranslation"], equals: true } },
      select: { id: true, problemNote: true },
      orderBy: { id: "asc" },
      take: limit,
    });
    return rows.map((r) => ({ id: r.id, value: r.problemNote }));
  },
  async save(db, id, previous, next) {
    const { count } = await db.stop.updateMany({
      where: { id, AND: [...stillPending("problemNote", previous)] },
      data: { problemNote: json(next) },
    });
    return count === 1;
  },
};

export const PENDING_SOURCES: readonly PendingSource[] = [
  customerNotesSource,
  stopProblemNoteSource,
];
