"use client";

import "leaflet/dist/leaflet.css";
import "./map.css";

import L from "leaflet";
import { MapPinOff, WifiOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";

import type { LatLng } from "@/lib/coords";
import type { MapTileConfig } from "@/lib/map-config";
import { useOnline } from "@/lib/use-online";
import { cn } from "@/lib/utils";

import { depotIcon, stopIcon, type StopMarkerStatus } from "./map-icons";

export type TourMapStop = {
  id: string;
  sequence: number;
  lat: number;
  lng: number;
  label?: string;
  /** Delivery status (NUD-054): colours the marker and adds a shape / badge cue. */
  status?: StopMarkerStatus;
};

export type TourMapProps = {
  /** Stops with a pin; markers show `sequence` (1...n). */
  stops: TourMapStop[];
  depot?: (LatLng & { label?: string }) | null;
  /** Road path as GeoJSON `LineString` coordinates (`[lng, lat]` pairs); omitted -> no line. */
  geometry?: Array<[number, number]> | null;
  tiles: MapTileConfig;
  className?: string;
  /** Driver map: 48 px markers and zoom buttons (backlog 4.3). */
  touch?: boolean;
};

/** Tile errors in a row (no tile loaded in between) after which the map gives up on tiles. */
const TILE_ERROR_LIMIT = 4;

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
export function TourMap({ stops, depot, geometry, tiles, className, touch = false }: TourMapProps) {
  const t = useTranslations("maps");
  const online = useOnline();
  // NUD-108: offline, or the provider does not answer -> no tile layer at all (no broken-tile grid,
  // no request storm), a plain background and a notice. Stops, depot and route stay.
  const [tileErrors, setTileErrors] = useState(0);
  const [wasOnline, setWasOnline] = useState(online);
  if (online !== wasOnline) {
    setWasOnline(online);
    if (online) setTileErrors(0); // connection is back: try the tiles again
  }
  const noTiles = !online || tileErrors >= TILE_ERROR_LIMIT;
  const line = (geometry ?? []).map(([lng, lat]) => [lat, lng] as [number, number]);
  const points: Array<[number, number]> = [
    ...stops.map((s) => [s.lat, s.lng] as [number, number]),
    ...(depot ? [[depot.lat, depot.lng] as [number, number]] : []),
    ...line,
  ];
  return (
    <div
      className={cn("nudel-map-wrap", touch && "nudel-map-touch", className)}
      data-testid="tour-map"
      data-tiles={noTiles ? "unavailable" : "ok"}
    >
      {noTiles ? (
        <div
          role="status"
          data-testid="map-tiles-notice"
          className="mb-2 flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-base text-amber-950"
        >
          <span className="flex shrink-0 items-center gap-1 pt-0.5" aria-hidden>
            {online ? null : <WifiOff className="size-5" />}
            <MapPinOff className="size-5" />
          </span>
          <span>
            <strong className="block font-semibold">
              {online ? t("tilesFailed") : t("tilesOffline")}
            </strong>
            <span>{t("tilesHint")}</span>
          </span>
        </div>
      ) : null}
      <MapContainer
        center={points[0] ?? VIENNA}
        zoom={13}
        className={cn("h-96 w-full rounded-md border", noTiles && "nudel-map-plain")}
        scrollWheelZoom
      >
        {noTiles ? null : (
          <TileLayer
            url={tiles.url}
            attribution={tiles.attribution}
            crossOrigin={tiles.cache ? "anonymous" : undefined}
            eventHandlers={{
              tileload: () => setTileErrors(0),
              tileerror: () => setTileErrors((n) => n + 1),
            }}
          />
        )}
        {line.length > 1 ? (
          <Polyline positions={line} pathOptions={{ color: "#1d4ed8", weight: 4, opacity: 0.8 }} />
        ) : null}
        {depot ? (
          <Marker
            position={[depot.lat, depot.lng]}
            icon={depotIcon(touch)}
            title={depot.label}
            zIndexOffset={500}
          >
            {depot.label ? <Tooltip>{depot.label}</Tooltip> : null}
          </Marker>
        ) : null}
        {stops.map((s) => (
          <Marker key={s.id} position={[s.lat, s.lng]} icon={stopIcon(s.sequence, s.status, touch)}>
            {s.label ? <Tooltip>{s.label}</Tooltip> : null}
          </Marker>
        ))}
        <FitBounds points={points} />
      </MapContainer>
    </div>
  );
}
