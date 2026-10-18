import {
  type DriverTourResponse,
  driverTourResponseSchema,
  tourPhotos,
} from "@/lib/driver-tour-model";

import { TOUR_API_PATH } from "./constants";
import { type PhotoCache, type PhotoSyncResult, syncPhotos } from "./photos";
import { type OfflineRecord, type OfflineStore, removeRecord, saveRecord } from "./store";

export type SyncOutcome =
  | {
      kind: "saved";
      record: OfflineRecord;
      photos: PhotoSyncResult;
    }
  | { kind: "no-tour"; date: string }
  | { kind: "unauthorized"; status: number }
  | { kind: "error"; reason: "network" | "server" | "invalid" | "storage" };

export type SyncDeps = {
  store: OfflineStore;
  photoCache: PhotoCache;
  fetchImpl: typeof fetch;
  now: () => Date;
  /** Called after the tour JSON is stored and before the photos are downloaded. */
  onStored?: (record: OfflineRecord) => void;
};

/**
 * Loads today's tour for `userId` from the server and makes the offline copy match it: the tour
 * JSON replaces the stored one (data of other users and other days is removed), the photos are
 * prefetched into Cache Storage and photos no longer needed are deleted. Failures leave the old
 * copy untouched; a 401/403 is reported but does not delete anything (purging happens on logout).
 */
export async function syncDriverTour(userId: string, deps: SyncDeps): Promise<SyncOutcome> {
  let response: Response;
  try {
    response = await deps.fetchImpl(TOUR_API_PATH, {
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
  } catch {
    return { kind: "error", reason: "network" };
  }
  if (response.status === 401 || response.status === 403) {
    return { kind: "unauthorized", status: response.status };
  }
  if (!response.ok) return { kind: "error", reason: "server" };

  let data: DriverTourResponse;
  try {
    data = driverTourResponseSchema.parse(await response.json());
  } catch {
    return { kind: "error", reason: "invalid" };
  }

  try {
    if (!data.tour) {
      // Nothing released today: nothing to keep (an older copy of a withdrawn tour would mislead).
      await removeRecord(deps.store, userId);
      await deps.photoCache.clear();
      return { kind: "no-tour", date: data.date };
    }
    const record: OfflineRecord = {
      userId,
      date: data.date,
      savedAt: deps.now().toISOString(),
      data,
    };
    await saveRecord(deps.store, record);
    deps.onStored?.(record);
    const photos = await syncPhotos(deps.photoCache, tourPhotos(data), deps.fetchImpl);
    return { kind: "saved", record, photos };
  } catch {
    return { kind: "error", reason: "storage" };
  }
}
