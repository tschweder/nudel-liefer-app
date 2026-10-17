import L from "leaflet";

/**
 * Marker icons are CSS-only `divIcon`s: Leaflet's default PNG icons break under bundlers and the
 * numbered tour markers need text anyway.
 */
export function pinIcon(): L.DivIcon {
  return L.divIcon({
    className: "nudel-map-icon",
    html: '<span class="nudel-pin" aria-hidden="true"></span>',
    iconSize: [28, 40],
    iconAnchor: [14, 38],
  });
}

export type StopMarkerStatus = "PENDING" | "DELIVERED" | "PROBLEM";

/**
 * Numbered stop marker. With a `status` (NUD-054) the colour AND the shape change: open = blue
 * circle, delivered = green circle with a check mark badge, problem = red diamond with a "!"
 * badge, so the status is readable without colour vision.
 */
export function stopIcon(sequence: number, status?: StopMarkerStatus): L.DivIcon {
  if (!status) {
    return L.divIcon({
      className: "nudel-map-icon",
      html: `<span class="nudel-stop" data-testid="stop-marker">${sequence}</span>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });
  }
  const badge = status === "DELIVERED" ? "&#10003;" : status === "PROBLEM" ? "!" : "";
  const shape = status === "PROBLEM" ? "nudel-stop-problem" : "";
  const inner =
    status === "PROBLEM" ? `<span class="nudel-stop-num">${sequence}</span>` : `${sequence}`;
  return L.divIcon({
    className: "nudel-map-icon",
    html:
      `<span class="nudel-stop nudel-stop-${status.toLowerCase()} ${shape}" ` +
      `data-testid="stop-marker" data-status="${status}">${inner}</span>` +
      (badge ? `<span class="nudel-stop-badge" aria-hidden="true">${badge}</span>` : ""),
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });
}

export function depotIcon(): L.DivIcon {
  return L.divIcon({
    className: "nudel-map-icon",
    html: '<span class="nudel-depot" data-testid="depot-marker" aria-hidden="true">&#9873;</span>',
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}
