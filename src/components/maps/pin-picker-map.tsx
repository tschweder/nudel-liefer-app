"use client";

import "leaflet/dist/leaflet.css";
import "./map.css";

import type L from "leaflet";
import { LocateFixedIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";

import { Button } from "@/components/ui/button";
import { type LatLng, roundLatLng } from "@/lib/coords";
import type { MapTileConfig } from "@/lib/map-config";
import { cn } from "@/lib/utils";

import { pinIcon } from "./map-icons";

export type PinPickerLabels = {
  locate: string;
  locating: string;
  noAddress: string;
  notFound: string;
  failed: string;
  lowConfidence: string;
};

export type LocateResult =
  | { ok: true; candidates: Array<{ lat: number; lng: number; label: string; confidence: number }> }
  | { ok: false; error: string };

export type PinPickerMapProps = {
  /** Current pin or `null` when none is set yet. */
  value: LatLng | null;
  /** Called with coordinates rounded to 6 decimals (click-to-place, drag, locate). */
  onChange: (value: LatLng) => void;
  tiles: MapTileConfig;
  /** Initial view while there is no pin (e.g. the depot). */
  fallbackCenter?: LatLng;
  /** Address text for the "locate address" button; the button is disabled while it is empty. */
  address?: string;
  /** Geocodes an address (an admin-only server action). Without it no locate button is shown. */
  onLocate?: (address: string) => Promise<LocateResult>;
  labels: PinPickerLabels;
  /**
   * Asks the map to centre on a point (e.g. a geocoder candidate chosen outside the map).
   * A new `nonce` triggers a new move, even to the same point.
   */
  focus?: { point: LatLng; zoom?: number; nonce: number } | null;
  className?: string;
};

const VIENNA: LatLng = { lat: 48.2082, lng: 16.3738 };
const LOW_CONFIDENCE = 0.5;

type FlyTarget = { point: LatLng; zoom: number; nonce: number };

function ClickToPlace({ onPlace }: { onPlace: (p: LatLng) => void }) {
  useMapEvents({ click: (e) => onPlace({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

function Flyer({ target }: { target: FlyTarget | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.setView([target.point.lat, target.point.lng], target.zoom, { animate: false });
  }, [map, target]);
  return null;
}

/**
 * Single draggable marker: click on the map places it, dragging moves it, and the optional
 * "locate address" button proposes a position from the geocoder. Always emits 6-decimal values.
 * Load it through `PinPickerMapLazy` (Leaflet needs `window`).
 */
export function PinPickerMap({
  value,
  onChange,
  tiles,
  fallbackCenter = VIENNA,
  address = "",
  onLocate,
  labels,
  focus,
  className,
}: PinPickerMapProps) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [target, setTarget] = useState<FlyTarget | null>(null);

  const emit = useCallback(
    (point: LatLng) => {
      setMessage(null);
      onChange(roundLatLng(point));
    },
    [onChange],
  );

  async function locate() {
    if (!onLocate) return;
    if (!address.trim()) {
      setMessage(labels.noAddress);
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await onLocate(address);
      if (!result.ok) {
        setMessage(labels.failed);
      } else if (result.candidates.length === 0) {
        setMessage(labels.notFound);
      } else {
        const best = result.candidates[0];
        const point = roundLatLng(best);
        onChange(point);
        setTarget({ point, zoom: 17, nonce: (target?.nonce ?? 0) + 1 });
        if (best.confidence < LOW_CONFIDENCE) setMessage(labels.lowConfidence);
      }
    } catch {
      setMessage(labels.failed);
    } finally {
      setBusy(false);
    }
  }

  const center = value ?? fallbackCenter;
  const flyTarget = useMemo<FlyTarget | null>(
    () => (focus ? { point: focus.point, zoom: focus.zoom ?? 17, nonce: focus.nonce } : target),
    // The nonce identifies a focus request; the point object may be recreated on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [focus?.nonce, target],
  );
  return (
    <div className={cn("nudel-map-wrap flex flex-col gap-2", className)} data-testid="pin-picker">
      {onLocate ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={locate}
            disabled={busy || !address.trim()}
            data-testid="pin-locate"
          >
            <LocateFixedIcon aria-hidden="true" />
            {busy ? labels.locating : labels.locate}
          </Button>
          <p className="text-sm text-muted-foreground" role="status" data-testid="pin-message">
            {message}
          </p>
        </div>
      ) : null}
      <MapContainer
        center={[center.lat, center.lng]}
        zoom={value ? 16 : 13}
        className="h-96 w-full rounded-md border"
        scrollWheelZoom
      >
        <TileLayer url={tiles.url} attribution={tiles.attribution} />
        <ClickToPlace onPlace={emit} />
        <Flyer target={flyTarget} />
        {value ? (
          <Marker
            position={[value.lat, value.lng]}
            icon={pinIcon()}
            draggable
            eventHandlers={{
              dragend: (e) => {
                const p = (e.target as L.Marker).getLatLng();
                emit({ lat: p.lat, lng: p.lng });
              },
            }}
          />
        ) : null}
      </MapContainer>
    </div>
  );
}
