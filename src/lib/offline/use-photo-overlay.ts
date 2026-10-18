import { useEffect, useMemo, useRef, useState } from "react";

import { DRIVER_PHOTO_KINDS, type DriverPhotoKind } from "@/domain/driver-photo";

import {
  confirmedKey,
  newestQueued,
  type PhotoEntry,
  type ShownPhoto,
  shownPhoto,
} from "./photo-outbox";
import { usePhotoOutbox } from "./photo-outbox-browser";

type PhotoLike = { id: string; url: string; width: number; height: number };

/**
 * Object URLs for the blobs of queued photos (the image is shown from the local blob, also while
 * offline). URLs are created after mount and revoked when the entry leaves the queue.
 */
function useBlobUrls(entries: readonly PhotoEntry[]): ReadonlyMap<string, string> {
  const created = useRef(new Map<string, string>());
  const [urls, setUrls] = useState<ReadonlyMap<string, string>>(new Map());
  useEffect(() => {
    const map = created.current;
    const wanted = new Set(entries.map((e) => e.clientMutationId));
    for (const entry of entries) {
      if (!map.has(entry.clientMutationId)) {
        map.set(entry.clientMutationId, URL.createObjectURL(entry.blob));
      }
    }
    for (const [id, url] of map) {
      if (!wanted.has(id)) {
        URL.revokeObjectURL(url);
        map.delete(id);
      }
    }
    setUrls(new Map(map));
  }, [entries]);
  useEffect(() => {
    const map = created.current;
    return () => {
      for (const url of map.values()) URL.revokeObjectURL(url);
      map.clear();
    };
  }, []);
  return urls;
}

/**
 * The two photo slots of a stop as the driver should see them (NUD-083): the photo he just took
 * (from the local blob, marked `pending`) wins over what the server just confirmed (`sent`), which
 * wins over the photo the page was rendered with. Identical to `photos` while nothing is queued.
 */
export function useOverlaidPhotos(
  customerId: string,
  photos: Record<DriverPhotoKind, PhotoLike | null>,
): Record<DriverPhotoKind, ShownPhoto | null> {
  const { entries, confirmed } = usePhotoOutbox();
  const mine = useMemo(
    () => entries.filter((e) => e.customerId === customerId),
    [entries, customerId],
  );
  const urls = useBlobUrls(mine);
  return useMemo(() => {
    const out = {} as Record<DriverPhotoKind, ShownPhoto | null>;
    for (const kind of DRIVER_PHOTO_KINDS) {
      out[kind] = shownPhoto(
        photos[kind],
        newestQueued(mine, customerId, kind),
        confirmed[confirmedKey(customerId, kind)],
        (entry) => urls.get(entry.clientMutationId),
      );
    }
    return out;
  }, [photos, mine, confirmed, urls, customerId]);
}
