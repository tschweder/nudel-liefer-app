"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { LatLng } from "@/lib/coords";
import type { MapTileConfig } from "@/lib/map-config";
import { geocodeAddressAction } from "@/server/geocode-actions";

import { PinPickerMapLazy, TourMapLazy } from "./lazy";
import type { TourMapStop } from "./tour-map";

/** Fixed sample data around Vienna: only for the dev page, never real deliveries. */
const SAMPLE_DEPOT = { lat: 48.2082, lng: 16.3738, label: "Depot" };
const SAMPLE_STOPS: TourMapStop[] = [
  { id: "s1", sequence: 1, lat: 48.2206, lng: 16.3969, label: "Trattoria Bella" },
  { id: "s2", sequence: 2, lat: 48.2388, lng: 16.4117, label: "Pizzeria Roma" },
  { id: "s3", sequence: 3, lat: 48.2243, lng: 16.3331, label: "Cucina Napoli", status: "PROBLEM" },
];
/**
 * Same corner as stop 1 (a few metres apart), to show the 28 px overlap rule. Off by default so the
 * e2e specs keep seeing the three numbered markers of the sample tour.
 */
const OVERLAP_STOPS: TourMapStop[] = [
  { id: "s4", sequence: 4, lat: 48.22062, lng: 16.39692, label: "Bar Venezia", status: "DELIVERED" },
  { id: "s5", sequence: 5, lat: 48.22058, lng: 16.39688, label: "Caffè Milano" },
];
const SAMPLE_GEOMETRY: Array<[number, number]> = [
  [16.3738, 48.2082],
  [16.3969, 48.2206],
  [16.4117, 48.2388],
  [16.3331, 48.2243],
  [16.3738, 48.2082],
];

export function MapsDemo({ tiles }: { tiles: MapTileConfig }) {
  const t = useTranslations("admin.devMaps");
  const tm = useTranslations("admin.maps");
  const [pin, setPin] = useState<LatLng | null>(null);
  const [address, setAddress] = useState("");
  const [changes, setChanges] = useState(0);
  const [overlap, setOverlap] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [cluster, setCluster] = useState<string[] | null>(null);

  const stops = overlap ? [...SAMPLE_STOPS, ...OVERLAP_STOPS] : SAMPLE_STOPS;
  const nameOf = (id: string) => {
    const stop = stops.find((candidate) => candidate.id === id);
    return stop?.label ?? String(stop?.sequence ?? "");
  };

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-semibold" data-testid="section-title">
          {t("title")}
        </h1>
        <p className="mt-1 text-base text-muted-foreground">{t("description")}</p>
      </div>

      <section className="flex flex-col gap-3" aria-labelledby="pin-heading">
        <h2 id="pin-heading" className="text-xl font-semibold">
          {t("pinPicker")}
        </h2>
        <div className="flex max-w-xl flex-col gap-2">
          <Label htmlFor="demo-address">{t("address")}</Label>
          <Input
            id="demo-address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder={t("addressPlaceholder")}
          />
        </div>
        <PinPickerMapLazy
          value={pin}
          onChange={(p) => {
            setPin(p);
            setChanges((n) => n + 1);
          }}
          tiles={tiles}
          address={address}
          onLocate={geocodeAddressAction}
          labels={{
            locate: tm("locate"),
            locating: tm("locating"),
            noAddress: tm("noAddress"),
            notFound: tm("notFound"),
            failed: tm("failed"),
            lowConfidence: tm("lowConfidence"),
          }}
        />
        <p className="text-base" data-testid="pin-value">
          {pin ? `${pin.lat.toFixed(6)}, ${pin.lng.toFixed(6)}` : t("noPin")}
        </p>
        <p className="text-sm text-muted-foreground" data-testid="pin-changes">
          {t("changes", { count: changes })}
        </p>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="tour-heading">
        <h2 id="tour-heading" className="text-xl font-semibold">
          {t("tourMap")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("sampleNote")}</p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-base text-muted-foreground">{t("linkageTitle")}</span>
          {stops.map((stop) => (
            <Button
              key={stop.id}
              type="button"
              size="sm"
              variant={selected === stop.id ? "default" : "outline"}
              aria-pressed={selected === stop.id}
              onClick={() => setSelected(stop.id)}
              data-testid={`demo-stop-${stop.id}`}
            >
              {stop.sequence}
            </Button>
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-pressed={overlap}
            onClick={() => {
              setOverlap((value) => !value);
              setCluster(null);
            }}
            data-testid="demo-overlap"
          >
            {overlap ? t("hideOverlap") : t("showOverlap")}
          </Button>
          <span className="text-base" data-testid="map-hover">
            {hovered ? nameOf(hovered) : ""}
          </span>
        </div>
        <div className="relative">
          {/* `touch` on purpose: the dev page shows the driver variant (48 px markers, 48 px zoom). */}
          <TourMapLazy
            stops={stops}
            depot={SAMPLE_DEPOT}
            geometry={SAMPLE_GEOMETRY}
            tiles={tiles}
            touch
            selectedId={selected}
            onSelect={setSelected}
            onHover={setHovered}
            onClusterSelect={setCluster}
          />
          {cluster ? (
            <div
              role="group"
              aria-label={t("clusterTitle", { count: cluster.length })}
              data-testid="cluster-popover"
              className="absolute top-3 left-3 z-[1000] w-64 rounded-lg border border-border bg-card p-3 shadow-lg"
            >
              <p className="text-base font-semibold">
                {t("clusterTitle", { count: cluster.length })}
              </p>
              <ul className="mt-2 space-y-1">
                {cluster.map((id) => (
                  <li key={id} className="text-base">
                    {nameOf(id)}
                  </li>
                ))}
              </ul>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={() => setCluster(null)}
              >
                {t("clusterClose")}
              </Button>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
