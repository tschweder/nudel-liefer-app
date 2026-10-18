import type { PrismaClient } from "@/generated/prisma/client";
import { CUSTOMER_PHOTO_KEY_PATTERN, SCREENSHOT_KEY_PATTERN } from "@/lib/uploads";

import type { Storage } from "./storage/types";

/**
 * Orphaned storage objects (NUD-094; follow-up of NUD-015 / NUD-031 / NUD-083): objects that were
 * uploaded (the browser PUT to a presigned URL) but never attached to a record - the action failed,
 * the tab was closed, a queued driver photo was finally rejected. They cost storage and, for
 * screenshots, hold personal data that the retention job (which works from rows) can never find.
 *
 * Deleting objects is irreversible, so this is deliberately cautious:
 *
 * - default mode is `dry-run` (only reports); `delete` must be switched on explicitly;
 * - grace period of at least 7 days (default 14): an object younger than that is never touched.
 *   A driver's photo can sit in the phone's queue for days after its upload; if its object is gone
 *   anyway, the app re-uploads it from the queued blob (`object_missing` handling, NUD-083);
 * - only keys of exactly the shapes the server issues are considered (`customers/<uuid>.<ext>`,
 *   `screenshots/<uuid>.<ext>`); anything else in the bucket is left alone and counted;
 * - an object is an orphan only if NO `Photo` and NO `Screenshot` row names it - replaced photos
 *   (history) stay referenced and are therefore kept;
 * - the reference is checked again immediately before each delete;
 * - plausibility valve: if more than half of at least 20 candidates look orphaned, something is
 *   wrong (wrong database, empty table) and nothing is deleted;
 * - at most 50 deletions per run, at most 10 000 listed objects per run.
 */
export const ORPHAN_MODES = ["off", "dry-run", "delete"] as const;
export type OrphanMode = (typeof ORPHAN_MODES)[number];
export const DEFAULT_ORPHAN_GRACE_DAYS = 14;
export const MIN_ORPHAN_GRACE_DAYS = 7;
export const MAX_ORPHAN_GRACE_DAYS = 365;
export const MAX_DELETES_PER_RUN = 50;
export const MAX_LISTED_PER_RUN = 10_000;
const LIST_PAGE = 1000;
const LOOKUP_BATCH = 500;
const SUSPICIOUS_MIN_CANDIDATES = 20;
const SUSPICIOUS_RATIO = 0.5;
const DAY_MS = 24 * 60 * 60 * 1000;

/** `ORPHAN_CLEANUP_MODE`: `off` | `dry-run` | `delete`; anything else (also unset) is `dry-run`. */
export function orphanCleanupMode(raw: string | undefined = process.env.ORPHAN_CLEANUP_MODE) {
  const value = raw?.trim().toLowerCase();
  return (ORPHAN_MODES as readonly string[]).includes(value ?? "")
    ? (value as OrphanMode)
    : "dry-run";
}

/** `ORPHAN_CLEANUP_GRACE_DAYS`: whole days, clamped to 7..365; unset or invalid = 14. */
export function orphanGraceDays(raw: string | undefined = process.env.ORPHAN_CLEANUP_GRACE_DAYS) {
  const value = raw?.trim();
  if (!value || !/^\d+$/.test(value)) return DEFAULT_ORPHAN_GRACE_DAYS;
  return Math.min(Math.max(Number(value), MIN_ORPHAN_GRACE_DAYS), MAX_ORPHAN_GRACE_DAYS);
}

export type OrphanReport = {
  mode: OrphanMode;
  graceDays: number;
  cutoff: string;
  /** Objects listed (both prefixes). */
  listed: number;
  /** More objects exist than one run lists. */
  truncated: boolean;
  /** Not of an app-issued key shape: never touched. */
  unexpected: number;
  /** Younger than the grace period: never touched. */
  young: number;
  /** Old enough to be judged. */
  candidates: number;
  /** Candidates without any database reference. */
  orphans: number;
  deleted: number;
  failed: number;
  /** Set when the plausibility valve stopped the run before any deletion. */
  aborted?: "suspicious_ratio";
  /** A few orphaned keys (random UUIDs, no personal data) for the log. */
  sample: string[];
};

type Db = Pick<PrismaClient, "photo" | "screenshot">;

async function referencedKeys(db: Db, keys: string[]): Promise<Set<string>> {
  const referenced = new Set<string>();
  for (let i = 0; i < keys.length; i += LOOKUP_BATCH) {
    const batch = keys.slice(i, i + LOOKUP_BATCH);
    const [photos, screenshots] = await Promise.all([
      db.photo.findMany({ where: { storageKey: { in: batch } }, select: { storageKey: true } }),
      db.screenshot.findMany({
        where: { storageKey: { in: batch } },
        select: { storageKey: true },
      }),
    ]);
    for (const row of [...photos, ...screenshots]) referenced.add(row.storageKey);
  }
  return referenced;
}

export async function cleanupOrphanedObjects(deps: {
  db: Db;
  storage: Storage;
  now?: Date;
  mode?: OrphanMode;
  graceDays?: number;
  maxDeletes?: number;
  maxListed?: number;
}): Promise<OrphanReport> {
  const { db, storage } = deps;
  const mode = deps.mode ?? orphanCleanupMode();
  const graceDays = deps.graceDays ?? orphanGraceDays();
  const now = deps.now ?? new Date();
  const cutoff = new Date(now.getTime() - graceDays * DAY_MS);
  const maxDeletes = deps.maxDeletes ?? MAX_DELETES_PER_RUN;
  const maxListed = deps.maxListed ?? MAX_LISTED_PER_RUN;

  const report: OrphanReport = {
    mode,
    graceDays,
    cutoff: cutoff.toISOString(),
    listed: 0,
    truncated: false,
    unexpected: 0,
    young: 0,
    candidates: 0,
    orphans: 0,
    deleted: 0,
    failed: 0,
    sample: [],
  };
  if (mode === "off") return report;

  const candidates: string[] = [];
  const shapes: Array<[string, RegExp]> = [
    ["customers/", CUSTOMER_PHOTO_KEY_PATTERN],
    ["screenshots/", SCREENSHOT_KEY_PATTERN],
  ];
  for (const [prefix, pattern] of shapes) {
    let token: string | undefined;
    do {
      const page = await storage.list(prefix, { limit: LIST_PAGE, continuationToken: token });
      for (const object of page.objects) {
        report.listed += 1;
        if (!pattern.test(object.key)) report.unexpected += 1;
        else if (object.lastModified > cutoff) report.young += 1;
        else candidates.push(object.key);
      }
      token = page.nextToken;
      if (token && report.listed >= maxListed) {
        report.truncated = true;
        token = undefined;
      }
    } while (token);
  }
  report.candidates = candidates.length;

  const referenced = await referencedKeys(db, candidates);
  const orphans = candidates.filter((key) => !referenced.has(key));
  report.orphans = orphans.length;
  report.sample = orphans.slice(0, 10);

  if (
    candidates.length >= SUSPICIOUS_MIN_CANDIDATES &&
    orphans.length / candidates.length > SUSPICIOUS_RATIO
  ) {
    report.aborted = "suspicious_ratio";
    return report;
  }
  if (mode !== "delete") return report;

  for (const key of orphans.slice(0, maxDeletes)) {
    try {
      // Last look before the irreversible step: a row may have appeared since the first check.
      if ((await referencedKeys(db, [key])).has(key)) continue;
      await storage.delete(key);
      report.deleted += 1;
    } catch (error) {
      report.failed += 1;
      console.error(`[orphan-cleanup] ${key} not deleted:`, error);
    }
  }
  return report;
}
