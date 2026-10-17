"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

const keyOf = (tourId: string) => `nudel.driver.seenRevision.${tourId}`;
const EVENT = "nudel:seen-revision";

function read(tourId: string): number {
  try {
    const value = Number(window.localStorage.getItem(keyOf(tourId)));
    return Number.isInteger(value) && value > 0 ? value : 0;
  } catch {
    return 0; // storage blocked: behave as "never seen" so changes stay visible
  }
}

function write(tourId: string, revision: number) {
  try {
    window.localStorage.setItem(keyOf(tourId), String(revision));
  } catch {
    // ignore: the notice just stays until the page is reloaded
  }
  window.dispatchEvent(new Event(EVENT));
}

/**
 * The last revision of this tour the driver has acknowledged on this device (0 = none). While the
 * tour has not been re-released the current revision is recorded silently, so a later re-release
 * is recognised as new. `markSeen` is called by the "Got it" button of the updated-tour banner.
 */
export function useSeenRevision(
  tourId: string,
  revision: number,
  updated: boolean,
): [seen: number, markSeen: () => void] {
  const subscribe = useCallback((notify: () => void) => {
    window.addEventListener(EVENT, notify);
    window.addEventListener("storage", notify);
    return () => {
      window.removeEventListener(EVENT, notify);
      window.removeEventListener("storage", notify);
    };
  }, []);
  const seen = useSyncExternalStore(
    subscribe,
    () => read(tourId),
    () => 0,
  );
  useEffect(() => {
    if (!updated && read(tourId) < revision) write(tourId, revision);
  }, [tourId, revision, updated]);
  const markSeen = useCallback(() => write(tourId, revision), [tourId, revision]);
  return [seen, markSeen];
}
