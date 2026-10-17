"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

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
  { id: "s1", sequence: 1, lat: 48.2206, lng: 16.3969, label: "Stop 1" },
  { id: "s2", sequence: 2, lat: 48.2388, lng: 16.4117, label: "Stop 2" },
  { id: "s3", sequence: 3, lat: 48.2243, lng: 16.3331, label: "Stop 3" },
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
        <TourMapLazy
          stops={SAMPLE_STOPS}
          depot={SAMPLE_DEPOT}
          geometry={SAMPLE_GEOMETRY}
          tiles={tiles}
        />
      </section>
    </div>
  );
}
