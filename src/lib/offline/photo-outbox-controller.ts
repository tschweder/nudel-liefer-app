import type { DriverPhotoKind } from "@/domain/driver-photo";

import {
  afterFailure,
  BACKOFF_MAX_MS,
  type BackoffState,
  FOREIGN_ENTRY_MAX_AGE_MS,
  mayAttempt,
  NO_BACKOFF,
  type OutboxNotice,
} from "./outbox";
import {
  CONFIRMED_PHOTO_TTL_MS,
  confirmedKey,
  type ConfirmedPhoto,
  type PhotoEntry,
  sortPhotoEntries,
  supersededBy,
} from "./photo-outbox";
import { flushPhotos, type PhotoFlushFailure, type PhotoFlushOutcome } from "./photo-outbox-flush";
import type { PhotoOutboxStore } from "./photo-outbox-store";

/**
 * The live state of the queued driver photos in one browser tab (NUD-083): enqueue a photo, flush
 * with backoff, remember what the server just confirmed. React reads it through `usePhotoOutbox`;
 * the controller itself is plain TypeScript and unit-tested with a memory store and a fake `fetch`.
 * Same shape and rules as the status outbox controller (NUD-082): source of truth is the store
 * (IndexedDB), backoff 2 s doubling to 5 min, `force` for "the situation changed".
 */
export type PhotoOutboxState = {
  userId: string | null;
  /** Queued photos of `userId`, in the order they were taken. */
  entries: readonly PhotoEntry[];
  inFlight: ReadonlySet<string>;
  flushing: boolean;
  failure: PhotoFlushFailure | null;
  /** Photos the server just took, by `customerId:kind`; dropped after `CONFIRMED_PHOTO_TTL_MS`. */
  confirmed: Readonly<Record<string, ConfirmedPhoto>>;
};

export type PhotoOutboxControllerDeps = {
  store: PhotoOutboxStore;
  putNotice: (notice: OutboxNotice) => Promise<void>;
  cachePhoto?: (photoId: string, blob: Blob) => Promise<void>;
  fetchImpl: typeof fetch;
  now: () => Date;
  newId: () => string;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
};

export type NewPhoto = {
  stopId: string;
  customerId: string;
  customerName: string;
  kind: DriverPhotoKind;
  blob: Blob;
  width: number;
  height: number;
};

const INITIAL: PhotoOutboxState = {
  userId: null,
  entries: [],
  inFlight: new Set(),
  flushing: false,
  failure: null,
  confirmed: {},
};

export function createPhotoOutboxController(deps: PhotoOutboxControllerDeps) {
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  let state: PhotoOutboxState = INITIAL;
  const listeners = new Set<() => void>();
  const flushedListeners = new Set<
    (outcome: Extract<PhotoFlushOutcome, { kind: "ran" }>) => void
  >();
  let backoff: BackoffState = NO_BACKOFF;
  let retryTimer: unknown = null;
  let running: Promise<PhotoFlushOutcome> | null = null;
  let again: { force: boolean } | null = null;
  let resolveReady!: () => void;
  const ready = new Promise<void>((resolve) => (resolveReady = resolve));
  let writes: Promise<unknown> = Promise.resolve();

  const set = (next: Partial<PhotoOutboxState>) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };

  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = writes.then(task, task);
    writes = run.catch(() => undefined);
    return run;
  };

  async function reload(): Promise<void> {
    const userId = state.userId;
    if (!userId) return;
    const entries = await deps.store.entries();
    set({ entries: sortPhotoEntries(entries.filter((e) => e.userId === userId)) });
  }

  /** Loads the queue of `userId`; photos of other drivers are removed 3 days after they were taken. */
  async function start(userId: string): Promise<void> {
    if (state.userId !== userId) set({ ...INITIAL, userId });
    try {
      const now = deps.now().getTime();
      for (const entry of await deps.store.entries()) {
        if (
          entry.userId !== userId &&
          now - Date.parse(entry.createdAt) > FOREIGN_ENTRY_MAX_AGE_MS
        ) {
          await deps.store.removeEntry(entry.clientMutationId);
        }
      }
      await reload();
    } catch {
      // No storage: the queue stays empty, `enqueue` then fails visibly.
    } finally {
      resolveReady();
    }
  }

  /**
   * Queues a photo. Older queued photos of the same customer and kind that no request carries are
   * dropped: the new one replaces them, nothing is lost that would ever have been visible.
   */
  async function enqueue(photo: NewPhoto): Promise<PhotoEntry> {
    await ready;
    const userId = state.userId;
    if (!userId) throw new Error("photo outbox: no user");
    return serial(async () => {
      const queued = (await deps.store.entries()).filter((e) => e.userId === userId);
      const entry: PhotoEntry = {
        clientMutationId: deps.newId(),
        userId,
        stopId: photo.stopId,
        customerId: photo.customerId,
        customerName: photo.customerName,
        kind: photo.kind,
        blob: photo.blob,
        width: photo.width,
        height: photo.height,
        createdAt: deps.now().toISOString(),
        seq: queued.reduce((max, e) => Math.max(max, e.seq), 0) + 1,
      };
      await deps.store.putEntry(entry);
      for (const id of supersededBy(queued, entry, state.inFlight)) {
        await deps.store.removeEntry(id);
      }
      await reload();
      return entry;
    });
  }

  function scheduleRetry() {
    if (retryTimer !== null) clearTimer(retryTimer);
    const wait = Math.min(Math.max(backoff.retryAt - deps.now().getTime(), 0), BACKOFF_MAX_MS);
    retryTimer = setTimer(() => {
      retryTimer = null;
      void flush();
    }, wait);
  }

  function flush(options: { force?: boolean } = {}): Promise<PhotoFlushOutcome> {
    const force = options.force ?? false;
    if (running) {
      again = { force: force || (again?.force ?? false) };
      return running;
    }
    if (!state.userId) return Promise.resolve({ kind: "empty" });
    if (!mayAttempt(backoff, deps.now().getTime(), force)) {
      return Promise.resolve({ kind: "empty" });
    }
    const userId = state.userId;
    running = (async (): Promise<PhotoFlushOutcome> => {
      set({ flushing: true });
      let last: PhotoFlushOutcome = { kind: "empty" };
      try {
        do {
          const wantForce = again?.force ?? force;
          again = null;
          if (!mayAttempt(backoff, deps.now().getTime(), wantForce)) break;
          const outcome = await flushPhotos(userId, {
            store: deps.store,
            putNotice: deps.putNotice,
            cachePhoto: deps.cachePhoto,
            fetchImpl: deps.fetchImpl,
            now: deps.now,
            onSending: (id) => set({ inFlight: new Set([...state.inFlight, id]) }),
            onSettled: (id) => {
              const next = new Set(state.inFlight);
              next.delete(id);
              set({ inFlight: next });
            },
          });
          last = outcome;
          if (outcome.kind === "ran") {
            handleRan(outcome);
            if (outcome.failure) break;
          }
        } while (again);
      } finally {
        running = null;
        again = null;
        set({ flushing: false });
        await reload().catch(() => undefined);
      }
      return last;
    })();
    return running;
  }

  function handleRan(outcome: Extract<PhotoFlushOutcome, { kind: "ran" }>) {
    if (outcome.failure) {
      backoff = afterFailure(backoff, deps.now().getTime());
      set({ failure: outcome.failure });
      scheduleRetry();
    } else {
      backoff = NO_BACKOFF;
      if (retryTimer !== null) clearTimer(retryTimer);
      retryTimer = null;
      set({ failure: null });
    }
    if (outcome.registered.length > 0) {
      const confirmed = { ...state.confirmed };
      for (const { entry, photo } of outcome.registered) {
        const key = confirmedKey(entry.customerId, entry.kind);
        const value: ConfirmedPhoto = { ...photo, customerId: entry.customerId, kind: entry.kind };
        confirmed[key] = value;
        setTimer(() => {
          if (state.confirmed[key] !== value) return;
          const rest = { ...state.confirmed };
          delete rest[key];
          set({ confirmed: rest });
        }, CONFIRMED_PHOTO_TTL_MS);
      }
      set({ confirmed });
    }
    if (outcome.registered.length + outcome.rejected > 0) {
      for (const listener of flushedListeners) listener(outcome);
    }
  }

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    /** Called after a flush registered or rejected at least one photo (the page refreshes). */
    onFlushed(listener: (outcome: Extract<PhotoFlushOutcome, { kind: "ran" }>) => void) {
      flushedListeners.add(listener);
      return () => void flushedListeners.delete(listener);
    },
    start,
    reload,
    enqueue,
    flush,
    ready: () => ready,
  };
}

export type PhotoOutboxController = ReturnType<typeof createPhotoOutboxController>;
