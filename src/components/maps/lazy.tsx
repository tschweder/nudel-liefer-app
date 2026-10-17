"use client";

import dynamic from "next/dynamic";

import { Skeleton } from "@/components/ui/skeleton";

const placeholder = () => <Skeleton className="h-96 w-full" />;

/** Client-only wrappers: Leaflet touches `window`, so the maps are never server-rendered. */
export const PinPickerMapLazy = dynamic(
  () => import("./pin-picker-map").then((m) => m.PinPickerMap),
  { ssr: false, loading: placeholder },
);

export const TourMapLazy = dynamic(() => import("./tour-map").then((m) => m.TourMap), {
  ssr: false,
  loading: placeholder,
});
