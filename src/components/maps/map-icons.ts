import L from "leaflet";

/**
 * Marker plumbing for the Leaflet maps (redesign RD-4, re-design.md §6).
 *
 * A marker's *content* is real React — `StopNumberBadge` for stops, a lucide icon for the depot —
 * rendered through a portal into a container element that is handed to `L.divIcon`. That way the
 * marker can never drift from the shared badge, and the page does not have to pull the
 * `react-dom/server` renderer (250 kB) into the client bundle just to build marker HTML.
 * Geometry and colours live in `map.css`.
 */

/** Markers closer than this many pixels at the current zoom collapse into one cluster badge. */
export const STOP_OVERLAP_PX = 28;

export type StopMarkerStatus = "PENDING" | "DELIVERED" | "PROBLEM";

/** Stop circle diameter in px; the selected/active marker is 48 px (re-design.md §6). */
export const MARKER_SIZE = 40;
export const MARKER_SIZE_SELECTED = 48;
/** Driver map: the divIcon box is the touch target, so it never drops below 48 px (backlog §4.3). */
export const MARKER_TOUCH_BOX = 48;

/** Box (divIcon) size of one stop marker: the badge plus the touch padding. */
export function markerBox(selected: boolean, touch: boolean): number {
  const circle = selected ? MARKER_SIZE_SELECTED : MARKER_SIZE;
  return touch ? Math.max(MARKER_TOUCH_BOX, circle) : circle;
}

/**
 * Off-screen container for one marker's React content. `display: contents` (the `contents` utility)
 * keeps it out of the layout, so the badge inside stays the flex item of the centring icon box.
 */
export function createMarkerContainer(): HTMLSpanElement {
  const element = document.createElement("span");
  element.className = "contents";
  return element;
}

/** Leaflet icon of a fixed box size whose only content is a rendered React marker. */
export function markerIcon(container: HTMLElement, box: number): L.DivIcon {
  return L.divIcon({
    className: "nudel-map-icon nudel-map-icon-center",
    html: container,
    iconSize: [box, box],
    iconAnchor: [box / 2, box / 2],
  });
}

/** One badge for a group of stops that overlap at the current zoom. */
export function clusterIcon(count: number, touch: boolean): L.DivIcon {
  const box = touch ? MARKER_TOUCH_BOX : MARKER_SIZE;
  return L.divIcon({
    className: "nudel-map-icon nudel-map-icon-center",
    html: `<span class="nudel-cluster" data-testid="stop-cluster" aria-hidden="true">${count}</span>`,
    iconSize: [box, box],
    iconAnchor: [box / 2, box / 2],
  });
}

/** Draggable delivery-address pin of the pin picker (QA-02). */
export function pinIcon(): L.DivIcon {
  return L.divIcon({
    className: "nudel-map-icon",
    html: '<span class="nudel-pin" aria-hidden="true"></span>',
    iconSize: [28, 40],
    iconAnchor: [14, 38],
  });
}
