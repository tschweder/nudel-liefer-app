import { OFFLINE_PHOTOS_STORE, OFFLINE_TOURS_STORE } from "./constants";
import { createIdbConnection, idbRun } from "./idb";
import type { PhotoEntry } from "./photo-outbox";

/**
 * Persistence of the queued driver photos (NUD-083): one IndexedDB row per photo, the resized
 * blob included (structured clone). The rules live in `photo-outbox.ts` / `photo-outbox-flush.ts`.
 * No zod: the service worker bundles this file.
 */
export interface PhotoOutboxStore {
  entries(): Promise<PhotoEntry[]>;
  putEntry(entry: PhotoEntry): Promise<void>;
  removeEntry(clientMutationId: string): Promise<void>;
  /** Same contract as `OutboxStore.updateTourRecord` (the stored tour copy of `userId`). */
  updateTourRecord(
    userId: string,
    update: (record: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<void>;
}

const isEntry = (raw: unknown): raw is PhotoEntry =>
  typeof raw === "object" &&
  raw !== null &&
  typeof (raw as PhotoEntry).clientMutationId === "string" &&
  typeof (raw as PhotoEntry).userId === "string" &&
  typeof (raw as PhotoEntry).stopId === "string" &&
  typeof (raw as PhotoEntry).customerId === "string" &&
  typeof (raw as PhotoEntry).createdAt === "string" &&
  (raw as PhotoEntry).blob instanceof Blob;

export function createIndexedDbPhotoStore(
  open: () => Promise<IDBDatabase> = createIdbConnection(),
): PhotoOutboxStore {
  const run = <T>(
    store: string,
    mode: IDBTransactionMode,
    fn: (s: IDBObjectStore) => IDBRequest<T>,
  ) => idbRun(open, store, mode, fn);
  return {
    entries: async () =>
      (await run(OFFLINE_PHOTOS_STORE, "readonly", (s) => s.getAll())).filter(isEntry),
    putEntry: async (entry) =>
      void (await run(OFFLINE_PHOTOS_STORE, "readwrite", (s) => s.put(entry))),
    removeEntry: async (id) =>
      void (await run(OFFLINE_PHOTOS_STORE, "readwrite", (s) => s.delete(id))),
    updateTourRecord: async (userId, update) => {
      const row = await run(OFFLINE_TOURS_STORE, "readonly", (s) => s.get(userId));
      if (typeof row !== "object" || row === null) return;
      const next = update(row as Record<string, unknown>);
      if (next !== row) await run(OFFLINE_TOURS_STORE, "readwrite", (s) => s.put(next));
    },
  };
}

export function createMemoryPhotoStore(): PhotoOutboxStore & {
  entryRows: Map<string, PhotoEntry>;
  tourRows: Map<string, Record<string, unknown>>;
} {
  const entryRows = new Map<string, PhotoEntry>();
  const tourRows = new Map<string, Record<string, unknown>>();
  return {
    entryRows,
    tourRows,
    // Blobs are immutable: sharing the reference is the same as the structured clone of IndexedDB.
    entries: async () => [...entryRows.values()].map((e) => ({ ...e })),
    putEntry: async (e) => void entryRows.set(e.clientMutationId, { ...e }),
    removeEntry: async (id) => void entryRows.delete(id),
    updateTourRecord: async (userId, update) => {
      const row = tourRows.get(userId);
      if (row) tourRows.set(userId, structuredClone(update(row)));
    },
  };
}
