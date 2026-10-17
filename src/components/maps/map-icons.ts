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

export function stopIcon(sequence: number): L.DivIcon {
  return L.divIcon({
    className: "nudel-map-icon",
    html: `<span class="nudel-stop" data-testid="stop-marker">${sequence}</span>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
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
