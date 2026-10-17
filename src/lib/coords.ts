export type LatLng = { lat: number; lng: number };

/** Rounds a coordinate to 6 decimals (~0.1 m), the precision stored for pins. */
export function roundCoord(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

export function roundLatLng(point: LatLng): LatLng {
  return { lat: roundCoord(point.lat), lng: roundCoord(point.lng) };
}

export function isValidLatLng(point: LatLng): boolean {
  return (
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lng) &&
    Math.abs(point.lat) <= 90 &&
    Math.abs(point.lng) <= 180
  );
}
