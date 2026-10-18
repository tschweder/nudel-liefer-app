import { z } from "zod";

import {
  applyTranslationSave,
  changesSource,
  CHINESE_LOCALES,
  describeTranslations,
  type FreshTranslations,
  mergeSourceChange,
  retranslateAll,
  type TranslationRow,
} from "@/domain/note-translations";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { createLocalizedText, type LocalizedText, localizedTextSchema } from "@/lib/localized-text";
import { hansToHk, hansToTw } from "@/lib/opencc";

import { getTranslator } from "./translator";
import { localize } from "./translator/localize";
import type { Translator } from "./translator/types";

/**
 * Customer notes as `LocalizedText` (NUD-071): German is the source; Chinese versions are machine
 * translations (NUD-070) until the office edits them. The pure merge rules live in
 * `src/domain/note-translations.ts`; this module adds the translator call and the database.
 */
type NotesDb = Pick<PrismaClient, "customer">;
type Options = { translator?: Translator; now?: Date };

export const MAX_NOTE_LENGTH = 2000;

/**
 * Machine translation of a German text into all three Chinese variants: one provider call
 * (Simplified), the Traditional variants via OpenCC. `null` when the provider fails or answers
 * with nothing; the text is not logged.
 */
export async function freshTranslations(
  german: string,
  translator: Translator = getTranslator(),
): Promise<FreshTranslations | null> {
  try {
    const hans = (await translator.translate(german, "de", "zh-Hans")).trim();
    if (hans === "") return null;
    return { "zh-Hans": hans, "zh-Hant-HK": hansToHk(hans), "zh-Hant-TW": hansToTw(hans) };
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    console.warn(
      `[translator] note translation failed (${typeof code === "string" ? code : "UNKNOWN"})`,
    );
    return null;
  }
}

function parseNotes(stored: unknown): LocalizedText | null {
  const parsed = localizedTextSchema.safeParse(stored);
  return parsed.success && parsed.data.meta.source === "de" && parsed.data.de?.trim()
    ? parsed.data
    : null;
}

/**
 * The value to store for the German note from the customer form: `null` for an empty note, the
 * stored JSON when the German text did not change, the merged text when it did (machine versions
 * re-translated, hand-written ones kept and flagged), a fresh `localize()` otherwise.
 */
export async function prepareNotes(
  stored: unknown,
  german: string | null,
  options: Options = {},
): Promise<LocalizedText | null> {
  if (german === null) return null;
  const current = parseNotes(stored);
  if (!current) return localize(german, "de", options);
  if (current.de === german) return localizedTextSchema.parse(stored);
  const fresh = await freshTranslations(german, options.translator);
  return mergeSourceChange(current, german, fresh, options.now);
}

/**
 * Like `prepareNotes`, but never calls the translator (the import writes hundreds of notes): a new
 * or changed German text is stored with `meta.pendingTranslation = true` and the retry job
 * (NUD-070) translates it later; hand-written Chinese versions are kept and flagged stale.
 */
export function prepareNotesWithoutTranslation(
  stored: unknown,
  german: string | null,
  now: Date = new Date(),
): LocalizedText | null {
  if (german === null) return null;
  const current = parseNotes(stored);
  if (!current) return createLocalizedText({ de: german }, "de", { now, pendingTranslation: true });
  if (current.de === german) return current;
  return mergeSourceChange(current, german, null, now);
}

export const notesJson = (
  notes: LocalizedText | null,
): Prisma.InputJsonValue | typeof Prisma.DbNull =>
  notes === null ? Prisma.DbNull : (notes as unknown as Prisma.InputJsonValue);

export type NoteTranslationsView = {
  customerId: string;
  /** Version token of the stored text (`meta.updatedAt`); sent back with every save. */
  updatedAt: string;
  /** The retry job still has to translate this note. */
  pending: boolean;
  rows: TranslationRow[];
};

function toView(customerId: string, text: LocalizedText): NoteTranslationsView {
  return {
    customerId,
    updatedAt: text.meta.updatedAt,
    pending: text.meta.pendingTranslation === true,
    rows: describeTranslations(text),
  };
}

const idSchema = z.string().trim().min(1).max(64);

/** `null` when the customer does not exist or has no (valid German) note. */
export async function getNoteTranslations(
  db: NotesDb,
  rawId: unknown,
): Promise<NoteTranslationsView | null> {
  const id = idSchema.safeParse(rawId);
  if (!id.success) return null;
  const row = await db.customer.findUnique({ where: { id: id.data }, select: { notes: true } });
  const notes = parseNotes(row?.notes);
  return notes ? toView(id.data, notes) : null;
}

const noteText = z.string().max(MAX_NOTE_LENGTH);
const chineseLocale = z.enum(CHINESE_LOCALES);

export const saveTranslationsSchema = z.object({
  customerId: idSchema,
  baseUpdatedAt: z.string().min(1).max(64),
  values: z.object({
    de: noteText.optional(),
    "zh-Hans": noteText.optional(),
    "zh-Hant-HK": noteText.optional(),
    "zh-Hant-TW": noteText.optional(),
  }),
  reviewed: z.array(chineseLocale).max(3).default([]),
});

export type NoteTranslationsResult =
  | { ok: true; view: NoteTranslationsView }
  | {
      ok: false;
      error: "invalid" | "not_found" | "no_notes" | "conflict" | "translation_failed";
    };

type Loaded = { ok: true; notes: LocalizedText } | { ok: false; error: "not_found" | "no_notes" };

async function load(db: NotesDb, id: string): Promise<Loaded> {
  const row = await db.customer.findUnique({ where: { id }, select: { notes: true } });
  if (!row) return { ok: false, error: "not_found" };
  const notes = parseNotes(row.notes);
  return notes ? { ok: true, notes } : { ok: false, error: "no_notes" };
}

/** Writes only if nobody changed the note since it was read (retry job, other office user). */
async function saveGuarded(
  db: NotesDb,
  id: string,
  previous: LocalizedText,
  next: LocalizedText,
): Promise<boolean> {
  const { count } = await db.customer.updateMany({
    where: { id, notes: { path: ["meta", "updatedAt"], equals: previous.meta.updatedAt } },
    data: { notes: notesJson(next) },
  });
  return count === 1;
}

/**
 * Saves the "Translations" tab: edited versions become hand-written, a changed German source
 * re-translates the machine versions only. The caller checked the role.
 */
export async function saveNoteTranslations(
  db: NotesDb,
  rawInput: unknown,
  options: Options = {},
): Promise<NoteTranslationsResult> {
  const parsed = saveTranslationsSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { customerId, baseUpdatedAt, values, reviewed } = parsed.data;
  if (values.de !== undefined && values.de.trim() === "") return { ok: false, error: "invalid" };
  const loaded = await load(db, customerId);
  if (!loaded.ok) return loaded;
  const stored = loaded.notes;
  if (stored.meta.updatedAt !== baseUpdatedAt) return { ok: false, error: "conflict" };
  const fresh = changesSource(stored, values)
    ? await freshTranslations(values.de ?? "", options.translator)
    : null;
  const next = applyTranslationSave(stored, { values, reviewed }, fresh, options.now);
  if (!(await saveGuarded(db, customerId, stored, next))) return { ok: false, error: "conflict" };
  return { ok: true, view: toView(customerId, next) };
}

/**
 * "Re-translate": replaces all three Chinese versions (hand-written ones too) with a new machine
 * translation of the German text. If the provider fails nothing is changed.
 */
export async function retranslateNote(
  db: NotesDb,
  rawId: unknown,
  options: Options = {},
): Promise<NoteTranslationsResult> {
  const id = idSchema.safeParse(rawId);
  if (!id.success) return { ok: false, error: "invalid" };
  const loaded = await load(db, id.data);
  if (!loaded.ok) return loaded;
  const fresh = await freshTranslations(loaded.notes.de ?? "", options.translator);
  if (!fresh) return { ok: false, error: "translation_failed" };
  const next = retranslateAll(loaded.notes, fresh, options.now);
  if (!(await saveGuarded(db, id.data, loaded.notes, next)))
    return { ok: false, error: "conflict" };
  return { ok: true, view: toView(id.data, next) };
}
