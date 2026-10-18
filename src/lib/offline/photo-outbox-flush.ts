import {
  FINAL_PHOTO_ERRORS,
  parsePhotoRegisterResponse,
  type PhotoRegisterError,
  type PhotoRegisterRequest,
  type PhotoRegisterResponse,
  type RegisteredPhoto,
} from "@/domain/driver-photo";

import { PHOTO_REGISTER_API_PATH } from "./constants";
import type { OutboxNotice } from "./outbox";
import {
  MAX_MISSING_RETRIES,
  patchTourPhoto,
  type PhotoEntry,
  sortPhotoEntries,
} from "./photo-outbox";
import type { PhotoOutboxStore } from "./photo-outbox-store";

/**
 * Sends the queued photos of `userId` (NUD-083). Used by the page and by the service worker
 * (Background Sync), so it only needs `fetch` and stores.
 *
 * Per photo, oldest first, and every step can be repeated safely:
 *  1. `POST /api/uploads` (presigned PUT URL) + `PUT` of the blob. Skipped when the entry already
 *     carries a `storageKey` (the PUT was done earlier; the entry is saved right after the PUT, so
 *     a retry registers instead of uploading again).
 *  2. `POST /api/driver/photos` with the entry's `clientMutationId`: the server creates the photo
 *     once; a retry (answer lost) is answered `replayed` with the same photo.
 *  3. On success the blob is put into the photo cache under the real photo id and the stored tour
 *     copy is patched, then the entry is removed.
 * A network or server problem ends the run (the order of photos of one slot must not be broken)
 * and keeps everything queued; the caller retries with backoff. An answer that can never succeed
 * (`not_found`, `tour_not_active`, an invalid request, ...) removes the photo and leaves a notice.
 */
export type PhotoFlushFailure = "network" | "server" | "unauthorized";

export type RegisteredInfo = {
  entry: PhotoEntry;
  photo: RegisteredPhoto;
  replayed: boolean;
};

export type PhotoFlushOutcome =
  | { kind: "empty" }
  | {
      kind: "ran";
      registered: RegisteredInfo[];
      rejected: number;
      notices: OutboxNotice[];
      failure: PhotoFlushFailure | null;
    };

export type PhotoFlushDeps = {
  store: PhotoOutboxStore;
  /** Notices live in the notice store of the status outbox. */
  putNotice: (notice: OutboxNotice) => Promise<void>;
  /** Stores the photo for offline display under its real id (Cache Storage); best effort. */
  cachePhoto?: (photoId: string, blob: Blob) => Promise<void>;
  fetchImpl: typeof fetch;
  now: () => Date;
  onSending?: (id: string) => void;
  onSettled?: (id: string) => void;
};

type Step =
  | { kind: "done"; response: Extract<PhotoRegisterResponse, { outcome: "applied" | "replayed" }> }
  | { kind: "final"; error: PhotoRegisterError | "invalid" }
  | { kind: "again" } // stored a changed entry, try the same entry once more later
  | { kind: "stop"; failure: PhotoFlushFailure };

const jsonHeaders = { "Content-Type": "application/json", Accept: "application/json" };

type UploadGrantLike = {
  storageKey: string;
  uploadUrl: string;
  headers: Record<string, string>;
};

async function upload(
  deps: PhotoFlushDeps,
  entry: PhotoEntry,
): Promise<{ kind: "ok"; storageKey: string } | Step> {
  let response: Response;
  try {
    response = await deps.fetchImpl("/api/uploads", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: jsonHeaders,
      body: JSON.stringify({
        purpose: "customer-photo",
        contentType: entry.blob.type,
        size: entry.blob.size,
      }),
    });
  } catch {
    return { kind: "stop", failure: "network" };
  }
  if (response.status === 401 || response.status === 403) {
    return { kind: "stop", failure: "unauthorized" };
  }
  // The blob can never be accepted (wrong type, too large): drop it with a notice.
  if (response.status === 400 || response.status === 413)
    return { kind: "final", error: "invalid" };
  if (!response.ok) return { kind: "stop", failure: "server" };
  let grant: UploadGrantLike;
  try {
    const raw = (await response.json()) as Partial<UploadGrantLike>;
    if (
      typeof raw.storageKey !== "string" ||
      typeof raw.uploadUrl !== "string" ||
      typeof raw.headers !== "object" ||
      raw.headers === null
    ) {
      return { kind: "stop", failure: "server" };
    }
    grant = raw as UploadGrantLike;
  } catch {
    return { kind: "stop", failure: "server" };
  }
  try {
    // The storage is another origin: its CORS rule has to allow PUT (docs/env.md, NUD-006).
    const put = await deps.fetchImpl(grant.uploadUrl, {
      method: "PUT",
      mode: "cors",
      credentials: "omit",
      headers: grant.headers,
      body: entry.blob,
    });
    // A rejected PUT (e.g. an expired signature) is retried with a fresh grant next time.
    if (!put.ok) return { kind: "stop", failure: "server" };
  } catch {
    return { kind: "stop", failure: "network" };
  }
  return { kind: "ok", storageKey: grant.storageKey };
}

async function sendOne(deps: PhotoFlushDeps, entry: PhotoEntry): Promise<Step> {
  let current = entry;
  if (!current.storageKey) {
    const uploaded = await upload(deps, current);
    if (uploaded.kind !== "ok") return uploaded;
    current = { ...current, storageKey: uploaded.storageKey };
    // From here on a retry only registers; losing this write only costs one more upload.
    await deps.store.putEntry(current);
  }
  const body: PhotoRegisterRequest = {
    clientMutationId: current.clientMutationId,
    stopId: current.stopId,
    kind: current.kind,
    storageKey: current.storageKey!,
    width: current.width,
    height: current.height,
  };
  let response: Response;
  try {
    response = await deps.fetchImpl(PHOTO_REGISTER_API_PATH, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: jsonHeaders,
      body: JSON.stringify(body),
    });
  } catch {
    return { kind: "stop", failure: "network" };
  }
  if (response.status === 401 || response.status === 403) {
    return { kind: "stop", failure: "unauthorized" };
  }
  if ([400, 413, 415].includes(response.status)) return { kind: "final", error: "invalid" };
  if (!response.ok) return { kind: "stop", failure: "server" };
  let parsed: PhotoRegisterResponse | null;
  try {
    parsed = parsePhotoRegisterResponse(await response.json());
  } catch {
    parsed = null;
  }
  if (!parsed) return { kind: "stop", failure: "server" };
  if (parsed.outcome !== "rejected") return { kind: "done", response: parsed };
  if (parsed.error === "object_missing") {
    // The server does not see the object: upload it again (bounded, then it is dropped).
    const missingCount = (current.missingCount ?? 0) + 1;
    if (missingCount >= MAX_MISSING_RETRIES) return { kind: "final", error: "object_missing" };
    const { storageKey: _dropped, ...rest } = current;
    void _dropped;
    await deps.store.putEntry({ ...rest, missingCount });
    return { kind: "again" };
  }
  return { kind: "final", error: parsed.error };
}

export async function flushPhotos(
  userId: string,
  deps: PhotoFlushDeps,
): Promise<PhotoFlushOutcome> {
  const queue = sortPhotoEntries((await deps.store.entries()).filter((e) => e.userId === userId));
  if (queue.length === 0) return { kind: "empty" };

  const registered: RegisteredInfo[] = [];
  const notices: OutboxNotice[] = [];
  let rejected = 0;
  let failure: PhotoFlushFailure | null = null;

  for (const original of queue) {
    // Re-read: an entry may have been replaced / removed since the list was taken.
    let entry: PhotoEntry | undefined = original;
    let attempts = 0;
    while (entry && attempts++ < MAX_MISSING_RETRIES) {
      deps.onSending?.(entry.clientMutationId);
      let step: Step;
      try {
        step = await sendOne(deps, entry);
      } finally {
        deps.onSettled?.(entry.clientMutationId);
      }

      if (step.kind === "again") {
        entry = (await deps.store.entries()).find(
          (e) => e.clientMutationId === original.clientMutationId,
        );
        continue;
      }
      if (step.kind === "stop") {
        failure = step.failure;
        entry = undefined;
        break;
      }
      if (step.kind === "final") {
        const notice: OutboxNotice = {
          id: entry.clientMutationId,
          userId: entry.userId,
          stopId: entry.stopId,
          customerName: entry.customerName,
          type: "photo",
          error: FINAL_PHOTO_ERRORS.includes(step.error as PhotoRegisterError)
            ? step.error
            : "invalid",
          createdAt: deps.now().toISOString(),
        };
        await deps.putNotice(notice);
        await deps.store.removeEntry(entry.clientMutationId);
        notices.push(notice);
        rejected += 1;
        entry = undefined;
        break;
      }
      // done
      const { photo, customerId, kind } = step.response;
      try {
        await deps.cachePhoto?.(photo.id, entry.blob);
      } catch {
        // Offline display falls back to the next tour sync, which downloads it.
      }
      await deps.store.updateTourRecord(userId, (row) =>
        row.data && typeof row.data === "object"
          ? {
              ...row,
              data: patchTourPhoto(
                row.data as Parameters<typeof patchTourPhoto>[0],
                customerId,
                kind,
                photo,
              ),
            }
          : row,
      );
      await deps.store.removeEntry(entry.clientMutationId);
      registered.push({ entry, photo, replayed: step.response.outcome === "replayed" });
      entry = undefined;
      break;
    }
    if (failure) break;
  }

  return { kind: "ran", registered, rejected, notices, failure };
}
