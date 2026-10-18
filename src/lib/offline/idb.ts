import {
  OFFLINE_DB_NAME,
  OFFLINE_DB_VERSION,
  OFFLINE_NOTICES_STORE,
  OFFLINE_OUTBOX_STORE,
  OFFLINE_TOURS_STORE,
} from "./constants";

/**
 * The one IndexedDB database of the driver app (NUD-081 tour copy, NUD-082 outbox and notices) and
 * the small promise helpers around it. No zod and no React: the service worker bundles this file.
 * Stores: `tours` (key `userId`), `outbox` (key `clientMutationId`), `notices` (key `id`).
 */

export function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

/** A lazily opened connection that reopens itself after the browser closed or upgraded it. */
export function createIdbConnection(): () => Promise<IDBDatabase> {
  let opened: Promise<IDBDatabase> | null = null;
  return () => {
    opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB is not available"));
        return;
      }
      const req = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(OFFLINE_TOURS_STORE)) {
          db.createObjectStore(OFFLINE_TOURS_STORE, { keyPath: "userId" });
        }
        if (!db.objectStoreNames.contains(OFFLINE_OUTBOX_STORE)) {
          db.createObjectStore(OFFLINE_OUTBOX_STORE, { keyPath: "clientMutationId" });
        }
        if (!db.objectStoreNames.contains(OFFLINE_NOTICES_STORE)) {
          db.createObjectStore(OFFLINE_NOTICES_STORE, { keyPath: "id" });
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
}

/** Runs one request on `storeName` in its own transaction and resolves when it has committed. */
export async function idbRun<T>(
  open: () => Promise<IDBDatabase>,
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  const transaction = db.transaction(storeName, mode);
  const done = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB aborted"));
  });
  const result = await idbRequest(run(transaction.objectStore(storeName)));
  await done;
  return result;
}
