import { OFFLINE_NOTICES_STORE, OFFLINE_OUTBOX_STORE, OFFLINE_TOURS_STORE } from "./constants";
import { createIdbConnection, idbRun } from "./idb";
import type { OutboxEntry, OutboxNotice } from "./outbox";

/**
 * Persistence of the outbox and of the unacknowledged notices (NUD-082). Rows are plain JSON; the
 * rules live in `outbox.ts` and `outbox-flush.ts`. No zod: the service worker bundles this file.
 */
export interface OutboxStore {
  entries(): Promise<OutboxEntry[]>;
  putEntry(entry: OutboxEntry): Promise<void>;
  removeEntry(clientMutationId: string): Promise<void>;
  notices(): Promise<OutboxNotice[]>;
  putNotice(notice: OutboxNotice): Promise<void>;
  removeNotice(id: string): Promise<void>;
  /**
   * Applies authoritative stop states to the stored tour copy of `userId` (a callback so the
   * caller decides how; the row stays untouched when it returns the same object).
   */
  updateTourRecord(
    userId: string,
    update: (record: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<void>;
  /** The user ids that have a stored tour copy (= the user the phone is logged in as). */
  tourUserIds(): Promise<string[]>;
}

const isEntry = (raw: unknown): raw is OutboxEntry =>
  typeof raw === "object" &&
  raw !== null &&
  typeof (raw as OutboxEntry).clientMutationId === "string" &&
  typeof (raw as OutboxEntry).userId === "string" &&
  typeof (raw as OutboxEntry).stopId === "string" &&
  typeof (raw as OutboxEntry).createdAt === "string";

const isNotice = (raw: unknown): raw is OutboxNotice =>
  typeof raw === "object" &&
  raw !== null &&
  typeof (raw as OutboxNotice).id === "string" &&
  typeof (raw as OutboxNotice).userId === "string";

export function createIndexedDbOutboxStore(
  open: () => Promise<IDBDatabase> = createIdbConnection(),
): OutboxStore {
  const run = <T>(
    store: string,
    mode: IDBTransactionMode,
    fn: (s: IDBObjectStore) => IDBRequest<T>,
  ) => idbRun(open, store, mode, fn);
  return {
    entries: async () =>
      (await run(OFFLINE_OUTBOX_STORE, "readonly", (s) => s.getAll())).filter(isEntry),
    putEntry: async (entry) =>
      void (await run(OFFLINE_OUTBOX_STORE, "readwrite", (s) => s.put(entry))),
    removeEntry: async (id) =>
      void (await run(OFFLINE_OUTBOX_STORE, "readwrite", (s) => s.delete(id))),
    notices: async () =>
      (await run(OFFLINE_NOTICES_STORE, "readonly", (s) => s.getAll())).filter(isNotice),
    putNotice: async (notice) =>
      void (await run(OFFLINE_NOTICES_STORE, "readwrite", (s) => s.put(notice))),
    removeNotice: async (id) =>
      void (await run(OFFLINE_NOTICES_STORE, "readwrite", (s) => s.delete(id))),
    updateTourRecord: async (userId, update) => {
      const row = await run(OFFLINE_TOURS_STORE, "readonly", (s) => s.get(userId));
      if (typeof row !== "object" || row === null) return;
      const next = update(row as Record<string, unknown>);
      if (next !== row) await run(OFFLINE_TOURS_STORE, "readwrite", (s) => s.put(next));
    },
    tourUserIds: async () => {
      const keys = await run(OFFLINE_TOURS_STORE, "readonly", (s) => s.getAllKeys());
      return keys.filter((k): k is string => typeof k === "string");
    },
  };
}

export function createMemoryOutboxStore(): OutboxStore & {
  entryRows: Map<string, OutboxEntry>;
  noticeRows: Map<string, OutboxNotice>;
  tourRows: Map<string, Record<string, unknown>>;
} {
  const entryRows = new Map<string, OutboxEntry>();
  const noticeRows = new Map<string, OutboxNotice>();
  const tourRows = new Map<string, Record<string, unknown>>();
  return {
    entryRows,
    noticeRows,
    tourRows,
    entries: async () => [...entryRows.values()].map((e) => structuredClone(e)),
    putEntry: async (e) => void entryRows.set(e.clientMutationId, structuredClone(e)),
    removeEntry: async (id) => void entryRows.delete(id),
    notices: async () => [...noticeRows.values()].map((n) => structuredClone(n)),
    putNotice: async (n) => void noticeRows.set(n.id, structuredClone(n)),
    removeNotice: async (id) => void noticeRows.delete(id),
    updateTourRecord: async (userId, update) => {
      const row = tourRows.get(userId);
      if (row) tourRows.set(userId, structuredClone(update(row)));
    },
    tourUserIds: async () => [...tourRows.keys()],
  };
}
