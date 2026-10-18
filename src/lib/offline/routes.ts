import { splitLocalePath } from "@/lib/access";

export type OfflineView = { view: "list" } | { view: "stop"; stopId: string };

/**
 * Which driver screen a URL shows in the offline shell: `/<locale>/driver/stops/<id>` is a stop,
 * everything else (`/<locale>/driver`, the shell's own URL, unknown paths) the tour list.
 */
export function parseOfflineView(pathname: string): OfflineView {
  const { rest } = splitLocalePath(pathname);
  const match = /^\/driver\/stops\/([^/]+)\/?$/.exec(rest);
  if (!match) return { view: "list" };
  try {
    return { view: "stop", stopId: decodeURIComponent(match[1]!) };
  } catch {
    return { view: "list" };
  }
}
