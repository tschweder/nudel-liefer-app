"use client";

import "leaflet/dist/leaflet.css";
import "./map.css";

import L from "leaflet";
import { useEffect } from "react";
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";

import type { LatLng } from "@/lib/coords";
import type { MapTileConfig } from "@/lib/map-config";
import { cn } from "@/lib/utils";

import { depotIcon, stopIcon } from "./map-icons";

export type TourMapStop = {
  id: string;
  sequence: number;
  lat: number;
  lng: number;
  label?: string;
};

export type TourMapProps = {
  /** Stops with a pin; markers show `sequence` (1...n). */
  stops: TourMapStop[];
  depot?: (LatLng & { label?: string }) | null;
  /** Road path as GeoJSON `LineString` coordinates (`[lng, lat]` pairs); omitted -> no line. */
  geometry?: Array<[number, number]> | null;
  tiles: MapTileConfig;
  className?: string;
};

const VIENNA: [number, number] = [48.2082, 16.3738];

function FitBounds({ points }: { points: Array<[number, number]> }) {
  const map = useMap();
  const key = points.map((p) => p.join(",")).join(";");
  useEffect(() => {
    if (points.length === 0) return;
    map.fitBounds(L.latLngBounds(points), { padding: [32, 32], maxZoom: 16, animate: false });
    // `key` captures the content of `points`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);
  return null;
}

/**
 * Numbered stop markers, depot marker and the road geometry; fits the view to everything shown.
 * Load it through `TourMapLazy` (Leaflet needs `window`).
 */
export function TourMap({ stops, depot, geometry, tiles, className }: TourMapProps) {
  const line = (geometry ?? []).map(([lng, lat]) => [lat, lng] as [number, number]);
  const points: Array<[number, number]> = [
    ...stops.map((s) => [s.lat, s.lng] as [number, number]),
    ...(depot ? [[depot.lat, depot.lng] as [number, number]] : []),
    ...line,
  ];
  return (
    <div className={cn("nudel-map-wrap", className)} data-testid="tour-map">
      <MapContainer
        center={points[0] ?? VIENNA}
        zoom={13}
        className="h-96 w-full rounded-md border"
        scrollWheelZoom
      >
        <TileLayer url={tiles.url} attribution={tiles.attribution} />
        {line.length > 1 ? (
          <Polyline positions={line} pathOptions={{ color: "#1d4ed8", weight: 4, opacity: 0.8 }} />
        ) : null}
        {depot ? (
          <Marker position={[depot.lat, depot.lng]} icon={depotIcon()} zIndexOffset={500}>
            {depot.label ? <Tooltip>{depot.label}</Tooltip> : null}
          </Marker>
        ) : null}
        {stops.map((s) => (
          <Marker key={s.id} position={[s.lat, s.lng]} icon={stopIcon(s.sequence)}>
            {s.label ? <Tooltip>{s.label}</Tooltip> : null}
          </Marker>
        ))}
        <FitBounds points={points} />
      </MapContainer>
    </div>
  );
}
