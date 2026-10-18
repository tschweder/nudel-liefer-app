import {
  dayInTimezone,
  type DriverTourResponse,
  driverTourResponseSchema,
} from "@/lib/driver-tour-model";

import { OFFLINE_DB_NAME, OFFLINE_DB_VERSION, OFFLINE_TOURS_STORE } from "./constants";

/**
 * What the browser keeps of the driver's work day (NUD-081): the tour JSON of ONE day for ONE user.
 * Rules (also in docs/offline.md):
 * - per user: the record is keyed by the user id and `saveRecord` removes everybody else's;
 * - per day: a record whose `date` is not today (factory time zone) is never shown and is removed;
 * - removed on logout / when the login page is shown (`purgeOfflineData`).
 */
export type OfflineRecord = {
  userId: string;
  /** The tour day (`YYYY-MM-DD`), copy of `data.date`. */
  date: string;
  /** When this copy was loaded from the server (ISO): "last updated". */
  savedAt: string;
  data: DriverTourResponse;
};

/** Minimal storage interface so the rules can be unit-tested without a browser. */
export interface OfflineStore {
  all(): Promise<unknown[]>;
  put(record: OfflineRecord): Promise<void>;
  remove(userId: string): Promise<void>;
  clear(): Promise<void>;
}

function parseRecord(raw: unknown): OfflineRecord | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const data = driverTourResponseSchema.safeParse(r.data);
  if (
    typeof r.userId !== "string" ||
    typeof r.savedAt !== "string" ||
    Number.isNaN(Date.parse(r.savedAt)) ||
    !data.success ||
    r.date !== data.data.date
  ) {
    return null;
  }
  return { userId: r.userId, date: data.data.date, savedAt: r.savedAt, data: data.data };
}

/** All valid records. Unreadable ones (older schema, damaged) are deleted. */
async function validRecords(store: OfflineStore): Promise<OfflineRecord[]> {
  const records: OfflineRecord[] = [];
  for (const raw of await store.all()) {
    const record = parseRecord(raw);
    if (record) {
      records.push(record);
    } else if (typeof raw === "object" && raw !== null && "userId" in raw) {
      await store.remove(String((raw as { userId: unknown }).userId));
    }
  }
  return records;
}

/** Stores `record` and removes the data of every other user (a shared phone keeps one driver's tour). */
export async function saveRecord(store: OfflineStore, record: OfflineRecord): Promise<void> {
  await store.put(record);
  for (const other of await validRecords(store)) {
    if (other.userId !== record.userId) await store.remove(other.userId);
  }
}

/** Removes the record of `userId` (the tour was withdrawn / nothing is released today). */
export function removeRecord(store: OfflineStore, userId: string): Promise<void> {
  return store.remove(userId);
}

/** Removes records of other days than `now`'s (factory time zone of each record). */
export async function purgeStaleRecords(store: OfflineStore, now: Date): Promise<void> {
  for (const record of await validRecords(store)) {
    if (record.date !== dayInTimezone(now, record.data.timezone)) await store.remove(record.userId);
  }
}

/**
 * The record to show while offline: the newest valid record of today, or `null`. Records of other
 * days are deleted on the way. With `userId` only that user's record qualifies.
 */
export async function loadCurrentRecord(
  store: OfflineStore,
  now: Date,
  userId?: string,
): Promise<OfflineRecord | null> {
  await purgeStaleRecords(store, now);
  const records = (await validRecords(store)).filter((r) => !userId || r.userId === userId);
  records.sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt));
  return records[0] ?? null;
}

export function createMemoryStore(): OfflineStore & { rows: Map<string, unknown> } {
  const rows = new Map<string, unknown>();
  return {
    rows,
    all: async () => [...rows.values()],
    put: async (record) => void rows.set(record.userId, structuredClone(record)),
    remove: async (userId) => void rows.delete(userId),
    clear: async () => rows.clear(),
  };
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

/** IndexedDB-backed store (browser only). */
export function createIndexedDbStore(): OfflineStore {
  let opened: Promise<IDBDatabase> | null = null;
  const open = () => {
    opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB is not available"));
        return;
      }
      const req = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(OFFLINE_TOURS_STORE)) {
          req.result.createObjectStore(OFFLINE_TOURS_STORE, { keyPath: "userId" });
        }
      };
      req.onsuccess = () => {
        // Another tab upgrading or the browser closing the connection: reopen on next use.
        req.result.onclose = () => (opened = null);
        req.result.onversionchange = () => {
          req.result.close();
          opened = null;
        };
        resolve(req.result);
      };
      req.onerror = () => {
        opened = null;
        reject(req.error ?? new Error("IndexedDB open failed"));
      };
    });
    return opened;
  };
  const tx = async <T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> => {
    const db = await open();
    const transaction = db.transaction(OFFLINE_TOURS_STORE, mode);
    const done = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB aborted"));
    });
    const result = await request(run(transaction.objectStore(OFFLINE_TOURS_STORE)));
    await done;
    return result;
  };
  return {
    all: () => tx("readonly", (s) => s.getAll()),
    put: async (record) => void (await tx("readwrite", (s) => s.put(record))),
    remove: async (userId) => void (await tx("readwrite", (s) => s.delete(userId))),
    clear: async () => void (await tx("readwrite", (s) => s.clear())),
  };
}
