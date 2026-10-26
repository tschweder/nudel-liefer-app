"use client";

import "leaflet/dist/leaflet.css";
import "./map.css";

import L from "leaflet";
import { House, MapPinOff, Maximize2, WifiOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  MapContainer,
  Marker,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
  ZoomControl,
} from "react-leaflet";

import { stopToneWithNext } from "@/components/shared/status";
import { StopNumberBadge } from "@/components/shared/stop-number-badge";
import type { LatLng } from "@/lib/coords";
import type { MapTileConfig } from "@/lib/map-config";
import { useOnline } from "@/lib/use-online";
import { cn } from "@/lib/utils";

import {
  clusterIcon,
  createMarkerContainer,
  markerBox,
  markerIcon,
  STOP_OVERLAP_PX,
  type StopMarkerStatus,
} from "./map-icons";

export type TourMapStop = {
  id: string;
  sequence: number;
  lat: number;
  lng: number;
  label?: string;
  /** Delivery status (NUD-054): colours the marker and adds a shape / badge cue. */
  status?: StopMarkerStatus;
  /** The stop the driver is heading to: brand tone plus a halo (re-design.md §6). */
  isNext?: boolean;
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
  /** Highlighted marker (list -> map). */
  selectedId?: string | null;
  /** A marker was tapped (map -> list: highlight the row / open the stop sheet). */
  onSelect?: (id: string) => void;
  /** A marker was hovered or focused; `null` when the pointer left. */
  onHover?: (id: string | null) => void;
  /**
   * A cluster badge was tapped. The caller opens the list (driver sheet / admin popover); tapping
   * the same badge again zooms into it. Without this callback the first tap already zooms in.
   */
  onClusterSelect?: (ids: string[]) => void;
  /** Fit the view to all stops when the data changes (default). The button always fits on demand. */
  fitAll?: boolean;
};

/** Tile errors in a row (no tile loaded in between) after which the map gives up on tiles. */
const TILE_ERROR_LIMIT = 4;

const VIENNA: [number, number] = [48.2082, 16.3738];

/* -------------------------------------------------------------------------- */
/* Pure helpers (unit-tested without a layout engine)                          */
/* -------------------------------------------------------------------------- */

/** A stop projected into map-container pixels. */
export type MapPoint = { id: string; x: number; y: number };

/** A group of markers drawn as one badge; `x`/`y` are the pixel centroid of its members. */
export type ClusterGroup = { ids: string[]; x: number; y: number };

/**
 * Groups markers that are closer than `threshold` pixels (re-design.md §6) so that no two badges
 * cover each other. Greedy, in input order, and chained: a marker joins the first group that has a
 * member within the threshold, which is what keeps a tight row of pins readable. Pure, so the
 * 28 px rule is testable without Leaflet.
 */
export function clusterPoints(points: MapPoint[], threshold = STOP_OVERLAP_PX): ClusterGroup[] {
  const groups: Array<{ ids: string[]; members: MapPoint[]; sumX: number; sumY: number }> = [];
  for (const point of points) {
    const group = groups.find((candidate) =>
      candidate.members.some(
        (member) =>
          Math.abs(member.x - point.x) < threshold &&
          Math.abs(member.y - point.y) < threshold &&
          Math.hypot(member.x - point.x, member.y - point.y) < threshold,
      ),
    );
    if (group) {
      group.ids.push(point.id);
      group.members.push(point);
      group.sumX += point.x;
      group.sumY += point.y;
    } else {
      groups.push({ ids: [point.id], members: [point], sumX: point.x, sumY: point.y });
    }
  }
  return groups.map((group) => ({
    ids: group.ids,
    x: group.sumX / group.ids.length,
    y: group.sumY / group.ids.length,
  }));
}

/** One drawn piece of the route: consecutive legs that share the same "delivered" state. */
export type RouteLegGroup = { positions: Array<[number, number]>; delivered: boolean };

/**
 * Splits the geometry into maximal runs of legs with the same state, so the route can be drawn at
 * 70 % opacity with delivered legs at 35 % (re-design.md §6). Leg `i` leads to the i-th stop in
 * sequence order; a leg beyond the last stop (the drive back to the depot) keeps the last state.
 * A route of uniformly open (or uniformly delivered) legs returns exactly one group, which keeps
 * the single `<path>` the e2e specs count.
 */
export function routeLegGroups(
  geometry: Array<[number, number]>,
  stops: TourMapStop[],
): RouteLegGroup[] {
  const line = geometry.map(([lng, lat]) => [lat, lng] as [number, number]);
  if (line.length < 2) return [];
  const ordered = [...stops].sort((a, b) => a.sequence - b.sequence);
  const isDelivered = (leg: number) =>
    ordered[Math.min(leg, ordered.length - 1)]?.status === "DELIVERED";
  const groups: RouteLegGroup[] = [];
  for (let leg = 0; leg < line.length - 1; leg++) {
    const delivered = isDelivered(leg);
    const last = groups[groups.length - 1];
    if (last && last.delivered === delivered) last.positions.push(line[leg + 1]!);
    else groups.push({ positions: [line[leg]!, line[leg + 1]!], delivered });
  }
  return groups;
}

/* -------------------------------------------------------------------------- */
/* Map plumbing                                                               */
/* -------------------------------------------------------------------------- */

/** Hands the Leaflet map instance to the surrounding component (fit-all button). */
function MapBridge({ onMap }: { onMap: (map: L.Map) => void }) {
  const map = useMap();
  useEffect(() => onMap(map), [map, onMap]);
  return null;
}

function FitBounds({ points, enabled }: { points: Array<[number, number]>; enabled: boolean }) {
  const map = useMap();
  const key = points.map((p) => p.join(",")).join(";");
  useEffect(() => {
    if (!enabled || points.length === 0) return;
    map.fitBounds(L.latLngBounds(points), { padding: [32, 32], maxZoom: 16, animate: false });
    // `key` captures the content of `points`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key, enabled]);
  return null;
}

/**
 * Recomputes the overlap clusters whenever the view settles: markers within 28 px at the current
 * zoom share one badge. Runs on `zoomend`/`moveend` and after the data changes; no plugin, no
 * per-frame work.
 */
function ClusterWatcher({
  stops,
  onClusters,
}: {
  stops: TourMapStop[];
  onClusters: (clusters: string[][]) => void;
}) {
  const map = useMap();
  const key = stops.map((stop) => `${stop.id}@${stop.lat},${stop.lng}`).join("|");
  const measure = useCallback(() => {
    const points = stops.map((stop) => {
      const point = map.latLngToContainerPoint([stop.lat, stop.lng]);
      return { id: stop.id, x: point.x, y: point.y };
    });
    onClusters(
      clusterPoints(points)
        .filter((group) => group.ids.length > 1)
        .map((g) => g.ids),
    );
  }, [map, stops, onClusters]);
  const eventHandlers = useMemo(() => ({ zoomend: measure, moveend: measure }), [measure]);
  useMapEvents(eventHandlers);
  useEffect(() => {
    void key;
    measure();
  }, [measure, key]);
  return null;
}

/** One stop marker: the shared badge plus the status cue, and the list <-> map callbacks. */
function StopMarker({
  stop,
  selected,
  box,
  title,
  onSelect,
  onHover,
}: {
  stop: TourMapStop;
  selected: boolean;
  box: number;
  title: string;
  onSelect?: (id: string) => void;
  onHover?: (id: string | null) => void;
}) {
  const [container] = useState<HTMLSpanElement>(createMarkerContainer);
  const icon = useMemo(() => markerIcon(container, box), [container, box]);
  const eventHandlers = useMemo(
    () => ({
      click: () => onSelect?.(stop.id),
      mouseover: () => onHover?.(stop.id),
      mouseout: () => onHover?.(null),
      focus: () => onHover?.(stop.id),
      blur: () => onHover?.(null),
    }),
    [onSelect, onHover, stop.id],
  );
  const cue = stop.status === "DELIVERED" ? "✓" : stop.status === "PROBLEM" ? "!" : null;
  return (
    <>
      <Marker
        position={[stop.lat, stop.lng]}
        icon={icon}
        title={title}
        alt={title}
        zIndexOffset={selected ? 1000 : stop.isNext ? 500 : 0}
        eventHandlers={eventHandlers}
      >
        {stop.label ? <Tooltip>{stop.label}</Tooltip> : null}
      </Marker>
      {createPortal(
        <>
          <span
            className="nudel-stop-marker"
            data-testid="stop-marker"
            data-status={stop.status}
            data-selected={selected ? "true" : undefined}
            data-next={stop.isNext ? "true" : undefined}
            aria-hidden="true"
          >
            <StopNumberBadge
              number={stop.sequence}
              tone={stopToneWithNext(stop.status ?? "PENDING", Boolean(stop.isNext))}
              size={selected ? 48 : 40}
            />
          </span>
          {cue ? (
            <span className="nudel-stop-badge" aria-hidden="true">
              {cue}
            </span>
          ) : null}
        </>,
        container,
      )}
    </>
  );
}

/** Depot marker: house icon in `--map-depot`. */
function DepotMarker({ depot, box }: { depot: LatLng & { label?: string }; box: number }) {
  const [container] = useState<HTMLSpanElement>(createMarkerContainer);
  const icon = useMemo(() => markerIcon(container, box), [container, box]);
  const t = useTranslations("maps");
  const title = depot.label ? t("depotMarker", { name: depot.label }) : t("depotMarkerPlain");
  return (
    <>
      <Marker
        position={[depot.lat, depot.lng]}
        icon={icon}
        title={title}
        alt={title}
        zIndexOffset={500}
      >
        {depot.label ? <Tooltip>{depot.label}</Tooltip> : null}
      </Marker>
      {createPortal(
        <span className="nudel-depot-marker" data-testid="depot-marker" aria-hidden="true">
          <House className="size-5" aria-hidden />
        </span>,
        container,
      )}
    </>
  );
}

/** One badge for a group of overlapping stops; second tap zooms in (re-design.md §6). */
function ClusterMarker({
  stops,
  name,
  more,
  box,
  onActivate,
}: {
  stops: TourMapStop[];
  name: string;
  more: string;
  box: number;
  onActivate?: (ids: string[]) => void;
}) {
  const map = useMap();
  const ids = useMemo(() => stops.map((stop) => stop.id), [stops]);
  const key = ids.join(",");
  const armed = useRef(false);
  const icon = useMemo(() => clusterIcon(stops.length, box >= 48), [stops.length, box]);
  const first = stops[0]!;

  useEffect(() => {
    armed.current = false;
  }, [key]);

  const zoomIn = useCallback(() => {
    map.fitBounds(L.latLngBounds(stops.map((stop) => [stop.lat, stop.lng] as [number, number])), {
      padding: [48, 48],
      maxZoom: 18,
      animate: true,
    });
  }, [map, stops]);

  const eventHandlers = useMemo(
    () => ({
      click: () => {
        if (!onActivate || armed.current) {
          zoomIn();
          return;
        }
        armed.current = true;
        onActivate(ids);
      },
    }),
    [onActivate, zoomIn, ids],
  );

  return (
    <Marker
      position={[first.lat, first.lng]}
      icon={icon}
      title={name}
      alt={name}
      zIndexOffset={800}
      eventHandlers={eventHandlers}
    >
      <Tooltip>{more}</Tooltip>
    </Marker>
  );
}

/* -------------------------------------------------------------------------- */
/* The map                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Stop markers (shared `StopNumberBadge`), depot marker, route line and overlap clustering; fits
 * the view to everything shown. Every marker carries an accessible name, never a bare digit
 * (fixes F4/QA-02). Load it through `TourMapLazy` (Leaflet needs `window`).
 */
export function TourMap({
  stops,
  depot,
  geometry,
  tiles,
  className,
  touch = false,
  selectedId = null,
  onSelect,
  onHover,
  onClusterSelect,
  fitAll = true,
}: TourMapProps) {
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

  const [map, setMap] = useState<L.Map | null>(null);
  const [clusters, setClusters] = useState<string[][]>([]);

  const legs = useMemo(() => routeLegGroups(geometry ?? [], stops), [geometry, stops]);
  const line = useMemo(() => legs.flatMap((leg) => leg.positions), [legs]);
  const stopPoints = useMemo(
    () => stops.map((stop) => [stop.lat, stop.lng] as [number, number]),
    [stops],
  );
  const fitPoints = useMemo(
    () => [...stopPoints, ...line, ...(depot ? [[depot.lat, depot.lng] as [number, number]] : [])],
    [stopPoints, line, depot],
  );
  const stopBounds = useMemo(
    () => [...stopPoints, ...(depot ? [[depot.lat, depot.lng] as [number, number]] : [])],
    [stopPoints, depot],
  );

  const setClusterIds = useCallback((next: string[][]) => {
    setClusters((previous) =>
      previous.length === next.length && previous.every((ids, i) => ids.join() === next[i]!.join())
        ? previous
        : next,
    );
  }, []);

  const clusterIndex = useMemo(() => {
    const index = new Map<string, number>();
    clusters.forEach((ids, i) => ids.forEach((id) => index.set(id, i)));
    return index;
  }, [clusters]);

  const stopTitle = useCallback(
    (stop: TourMapStop) =>
      stop.label
        ? t("stopMarker", { n: stop.sequence, name: stop.label })
        : t("stopMarkerPlain", { n: stop.sequence }),
    [t],
  );

  const tileHandlers = useMemo(
    () => ({
      tileload: () => setTileErrors(0),
      tileerror: () => setTileErrors((n) => n + 1),
    }),
    [],
  );

  const byId = useMemo(() => new Map(stops.map((stop) => [stop.id, stop])), [stops]);
  const clusterBox = touch ? 48 : 40;

  const renderStop = (stop: TourMapStop): ReactNode => {
    const index = clusterIndex.get(stop.id);
    if (index !== undefined) {
      const ids = clusters[index]!;
      if (ids[0] !== stop.id) return null; // already drawn by the first member
      const members = ids
        .map((id) => byId.get(id))
        .filter((member): member is TourMapStop => Boolean(member));
      const names = members
        .map((member) =>
          member.label ? member.label : t("stopMarkerPlain", { n: member.sequence }),
        )
        .join(", ");
      return (
        <ClusterMarker
          key={`cluster-${stop.id}`}
          stops={members}
          name={t("cluster", { count: members.length, names })}
          more={t("clusterMore")}
          box={clusterBox}
          onActivate={onClusterSelect}
        />
      );
    }
    const selected = stop.id === selectedId;
    return (
      <StopMarker
        key={stop.id}
        stop={stop}
        selected={selected}
        box={markerBox(selected, touch)}
        title={stopTitle(stop)}
        onSelect={onSelect}
        onHover={onHover}
      />
    );
  };

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
          className="mb-2 flex items-start gap-3 rounded-md border border-warning bg-warning-soft p-3 text-base text-warning-soft-foreground"
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
      <div className="relative">
        <MapContainer
          center={stopPoints[0] ?? VIENNA}
          zoom={13}
          className={cn("h-96 w-full rounded-md border", noTiles && "nudel-map-plain")}
          scrollWheelZoom
          zoomControl={false}
        >
          {noTiles ? null : (
            <TileLayer
              url={tiles.url}
              attribution={tiles.attribution}
              crossOrigin={tiles.cache ? "anonymous" : undefined}
              eventHandlers={tileHandlers}
            />
          )}
          {legs.map((leg, index) =>
            leg.positions.length > 1 ? (
              <Polyline
                key={index}
                positions={leg.positions}
                pathOptions={{
                  color: "currentColor",
                  weight: 4,
                  opacity: 0.7,
                  lineCap: "round",
                  lineJoin: "round",
                  className: leg.delivered ? "nudel-route nudel-route-done" : "nudel-route",
                }}
              />
            ) : null,
          )}
          {depot ? <DepotMarker depot={depot} box={touch ? 48 : 40} /> : null}
          {stops.map(renderStop)}
          <FitBounds points={fitPoints} enabled={fitAll} />
          <MapBridge onMap={setMap} />
          <ClusterWatcher stops={stops} onClusters={setClusterIds} />
          <ZoomControl position="bottomright" />
        </MapContainer>
        <button
          type="button"
          data-testid="fit-all"
          onClick={() => {
            if (!map || stopBounds.length === 0) return;
            map.fitBounds(L.latLngBounds(stopBounds), {
              padding: [32, 32],
              maxZoom: 16,
              animate: true,
            });
          }}
          className={cn(
            "absolute top-3 right-3 z-[1000] inline-flex items-center gap-2 rounded-md border border-border bg-card font-medium text-foreground shadow-sm transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            touch ? "min-h-12 px-4 text-base" : "min-h-9 px-3 text-sm",
          )}
        >
          <Maximize2 className="size-4 shrink-0" aria-hidden />
          {t("fitAll")}
        </button>
      </div>
    </div>
  );
}
