// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { type AbstractIntlMessages, NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import de from "../../../messages/de.json";
import zhHans from "../../../messages/zh-Hans.json";
import zhHantHK from "../../../messages/zh-Hant-HK.json";
import zhHantTW from "../../../messages/zh-Hant-TW.json";

const online = vi.hoisted(() => ({ value: true }));
vi.mock("@/lib/use-online", () => ({ useOnline: () => online.value }));

type TileHandlers = { tileload: () => void; tileerror: () => void };
const tile = vi.hoisted(() => ({ handlers: null as TileHandlers | null }));

// Leaflet needs a real layout engine; the markup of the degraded state is what is tested here.
vi.mock("react-leaflet", () => ({
  MapContainer: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div data-testid="leaflet" className={className}>
      {children}
    </div>
  ),
  TileLayer: ({ eventHandlers }: { eventHandlers: TileHandlers }) => {
    tile.handlers = eventHandlers;
    return <div data-testid="tile-layer" />;
  },
  Polyline: () => <div data-testid="route-line" />,
  Marker: ({ title }: { title?: string }) => <div data-testid="marker" data-title={title} />,
  Tooltip: () => null,
  useMap: () => ({ fitBounds: vi.fn() }),
}));
vi.mock("leaflet", () => ({
  default: { latLngBounds: () => ({}), divIcon: () => ({}) },
  divIcon: () => ({}),
}));
vi.mock("leaflet/dist/leaflet.css", () => ({}));
vi.mock("./map.css", () => ({}));

import { TourMap } from "./tour-map";

const LOCALES: Record<string, AbstractIntlMessages> = {
  de,
  "zh-Hans": zhHans,
  "zh-Hant-HK": zhHantHK,
  "zh-Hant-TW": zhHantTW,
};
const STOPS = [
  { id: "a", sequence: 1, lat: 48.2, lng: 16.3, label: "Trattoria 1" },
  { id: "b", sequence: 2, lat: 48.21, lng: 16.31, label: "Trattoria 2" },
];
const GEOMETRY: Array<[number, number]> = [
  [16.3, 48.2],
  [16.31, 48.21],
];
const TILES = { url: "https://t.example/{z}/{x}/{y}.png", attribution: "© Example" };

function renderMap(locale: string) {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={LOCALES[locale]}
      onError={(error) => {
        throw error;
      }}
    >
      <TourMap
        stops={STOPS}
        depot={{ lat: 48.19, lng: 16.29, label: "Depot" }}
        geometry={GEOMETRY}
        tiles={TILES}
        touch
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  online.value = true;
  tile.handlers = null;
});
afterEach(cleanup);

describe("TourMap without tiles (NUD-108)", () => {
  it("online: tile layer, no notice", () => {
    renderMap("de");
    expect(screen.getByTestId("tile-layer")).toBeTruthy();
    expect(screen.queryByTestId("map-tiles-notice")).toBeNull();
    expect(screen.getByTestId("tour-map").dataset.tiles).toBe("ok");
  });

  it.each([
    ["de", "Kartenhintergrund offline nicht verfügbar"],
    ["zh-Hans", "离线时无法显示地图背景"],
    ["zh-Hant-HK", "離線時無法顯示地圖背景"],
    ["zh-Hant-TW", "離線時無法顯示地圖背景"],
  ])("offline in %s: notice, plain background, stops / depot / route stay", (locale, title) => {
    online.value = false;
    renderMap(locale);
    const notice = screen.getByTestId("map-tiles-notice");
    expect(notice.getAttribute("role")).toBe("status");
    expect(notice.textContent).toContain(title);
    expect(notice.querySelectorAll("svg").length).toBe(2); // wifi-off + map-pin-off, decorative
    expect(screen.queryByTestId("tile-layer")).toBeNull();
    expect(screen.getByTestId("leaflet").className).toContain("nudel-map-plain");
    expect(screen.getAllByTestId("marker")).toHaveLength(3); // 2 stops + depot
    expect(screen.getByTestId("route-line")).toBeTruthy();
    expect(screen.getByTestId("tour-map").dataset.tiles).toBe("unavailable");
  });

  it("gives up on tiles after repeated errors while online", () => {
    renderMap("de");
    for (let i = 0; i < 4; i++) act(() => tile.handlers!.tileerror());
    const notice = screen.getByTestId("map-tiles-notice");
    expect(notice.textContent).toContain("Kartenhintergrund nicht verfügbar");
    expect(notice.querySelectorAll("svg").length).toBe(1);
    expect(screen.queryByTestId("tile-layer")).toBeNull();
  });

  it("a loaded tile resets the error count", () => {
    renderMap("de");
    for (let i = 0; i < 3; i++) act(() => tile.handlers!.tileerror());
    act(() => tile.handlers!.tileload());
    for (let i = 0; i < 3; i++) act(() => tile.handlers!.tileerror());
    expect(screen.queryByTestId("map-tiles-notice")).toBeNull();
  });
});
