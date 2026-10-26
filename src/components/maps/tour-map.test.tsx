// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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

/** Pixel projection of the fake map; tests override it to force overlap. */
const project = vi.hoisted(() => ({
  fn: (lat: number, lng: number) => ({ x: lng * 10000, y: lat * 10000 }),
}));
const fakeMap = vi.hoisted(() => ({
  fitBounds: vi.fn(),
  latLngToContainerPoint: (latlng: [number, number]) => project.fn(latlng[0], latlng[1]),
}));

/** The mocked Leaflet icon is `{ options }`; `options.html` is the marker's portal container. */
type IconLike = { options?: { html?: HTMLElement | string; className?: string } };
type MarkerProps = {
  title?: string;
  alt?: string;
  position: [number, number];
  icon?: IconLike;
  eventHandlers?: Record<string, (...args: unknown[]) => void>;
};
/**
 * Every `<Marker>` a render pass produced. React re-renders the map (the map instance arrives in an
 * effect), so look markers up by their accessible name — that is stable across passes.
 */
const markerProps = vi.hoisted(() => [] as MarkerProps[]);

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
  Polyline: ({ pathOptions }: { pathOptions?: { className?: string } }) => (
    <div data-testid="route-line" data-class={pathOptions?.className} />
  ),
  Marker: (props: MarkerProps) => {
    markerProps.push(props);
    return <div data-testid="marker" data-title={props.title} data-alt={props.alt} />;
  },
  Tooltip: () => null,
  ZoomControl: () => null,
  useMap: () => fakeMap,
  useMapEvents: () => fakeMap,
}));
vi.mock("leaflet", () => ({
  default: {
    latLngBounds: () => ({}),
    divIcon: (options: IconLike["options"]) => ({ options }),
  },
  divIcon: (options: IconLike["options"]) => ({ options }),
}));
vi.mock("leaflet/dist/leaflet.css", () => ({}));
vi.mock("./map.css", () => ({}));

import { clusterPoints, routeLegGroups, TourMap, type TourMapStop } from "./tour-map";

/**
 * The `maps.*` keys this component reads that live in `messages/_fragments/M1.json` until the
 * orchestrator merges it into `de.json` / `zh-Hans.json` (the generated `zh-Hant-*` files follow).
 */
const M1_MAPS: Record<string, Record<string, string>> = {
  de: {
    stopMarker: "Stopp {n}: {name}",
    stopMarkerPlain: "Stopp {n}",
    cluster: "{count, plural, one {# Stopp} other {# Stopps}}: {names}",
    clusterMore: "Erneut tippen zum Vergrößern",
    fitAll: "Alle Stopps anzeigen",
  },
  "zh-Hans": {
    stopMarker: "站点 {n}：{name}",
    stopMarkerPlain: "站点 {n}",
    cluster: "{count} 个站点：{names}",
    clusterMore: "再次点击可放大",
    fitAll: "显示所有站点",
  },
};

const LOCALES: Record<string, AbstractIntlMessages> = {
  de,
  "zh-Hans": zhHans,
  "zh-Hant-HK": zhHantHK,
  "zh-Hant-TW": zhHantTW,
};

/** Real messages plus the fragment overrides (the Hant files are generated from zh-Hans). */
function messagesFor(locale: string): AbstractIntlMessages {
  const base = LOCALES[locale]!;
  const extra = M1_MAPS[locale] ?? M1_MAPS["zh-Hans"]!;
  return { ...base, maps: { ...(base.maps as object), ...extra } };
}

const STOPS: TourMapStop[] = [
  { id: "a", sequence: 1, lat: 48.2, lng: 16.3, label: "Trattoria 1" },
  { id: "b", sequence: 2, lat: 48.21, lng: 16.31, label: "Trattoria 2" },
];
const GEOMETRY: Array<[number, number]> = [
  [16.3, 48.2],
  [16.31, 48.21],
];
const TILES = { url: "https://t.example/{z}/{x}/{y}.png", attribution: "© Example" };

function renderMap(locale: string, overrides: Partial<Parameters<typeof TourMap>[0]> = {}) {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={messagesFor(locale)}
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
        {...overrides}
      />
    </NextIntlClientProvider>,
  );
}

/** Titles of the markers currently in the DOM, in render order. */
function markerTitles(): Array<string | null> {
  return screen.getAllByTestId("marker").map((node) => node.getAttribute("data-title"));
}

function markerByTitle(title: string): MarkerProps {
  const found = [...markerProps].reverse().find((props) => props.title === title);
  if (!found) throw new Error(`no marker named "${title}"`);
  return found;
}

/** The portal content of a marker: the element Leaflet would put into the map. */
function markerHtml(title: string): HTMLElement {
  const html = markerByTitle(title).icon?.options?.html;
  if (!(html instanceof HTMLElement)) throw new Error(`marker "${title}" has no element icon`);
  return html;
}

function routeClasses(): Array<string | null> {
  return screen.getAllByTestId("route-line").map((node) => node.getAttribute("data-class"));
}

beforeEach(() => {
  online.value = true;
  tile.handlers = null;
  markerProps.length = 0;
  project.fn = (lat, lng) => ({ x: lng * 10000, y: lat * 10000 });
  fakeMap.fitBounds.mockClear();
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

describe("marker accessible names (F4 / QA-02)", () => {
  it("names the depot and every stop with its customer, never a bare digit", () => {
    renderMap("de");
    expect(markerTitles()).toEqual([
      "Depot: Depot",
      "Stopp 1: Trattoria 1",
      "Stopp 2: Trattoria 2",
    ]);
    for (const node of screen.getAllByTestId("marker")) {
      const title = node.getAttribute("data-title");
      expect(node.getAttribute("data-alt")).toBe(title);
      expect(title).not.toMatch(/^\d+$/);
    }
  });

  it("translates the names", () => {
    renderMap("zh-Hans");
    expect(markerTitles()[1]).toBe("站点 1：Trattoria 1");
  });

  it("falls back to the number when a stop has no customer name", () => {
    renderMap("de", { stops: [{ id: "a", sequence: 7, lat: 48.2, lng: 16.3 }] });
    expect(markerTitles()).toEqual(["Depot: Depot", "Stopp 7"]);
  });

  it("puts the shared badge inside the marker, decorative and hidden from the a11y tree", () => {
    renderMap("de");
    const badge = markerHtml("Stopp 1: Trattoria 1").querySelector('[data-testid="stop-marker"]');
    expect(badge?.getAttribute("aria-hidden")).toBe("true");
    expect(badge?.getAttribute("data-status")).toBeNull();
    expect(badge?.querySelector('[data-tone="neutral"]')?.textContent).toBe("1");
  });

  it("adds the non-colour status cue for delivered and problem stops", () => {
    renderMap("de", {
      stops: [
        { ...STOPS[0]!, status: "DELIVERED" },
        { ...STOPS[1]!, status: "PROBLEM", isNext: true },
      ],
    });
    const delivered = markerHtml("Stopp 1: Trattoria 1");
    const problem = markerHtml("Stopp 2: Trattoria 2");
    expect(
      delivered.querySelector('[data-testid="stop-marker"]')?.getAttribute("data-status"),
    ).toBe("DELIVERED");
    expect(delivered.querySelector(".nudel-stop-badge")?.textContent).toBe("✓");
    expect(problem.querySelector('[data-testid="stop-marker"]')?.getAttribute("data-status")).toBe(
      "PROBLEM",
    );
    expect(problem.querySelector(".nudel-stop-badge")?.textContent).toBe("!");
    // "next" is the brand tone plus the cue, never colour alone.
    expect(problem.querySelector('[data-tone="primary"]')).not.toBeNull();
  });

  it("grows the selected marker to 48 px", () => {
    renderMap("de", { selectedId: "b", touch: false });
    const selected = markerHtml("Stopp 2: Trattoria 2").querySelector(
      '[data-testid="stop-marker"]',
    );
    expect(selected?.getAttribute("data-selected")).toBe("true");
    expect(selected?.querySelector(".size-12")).not.toBeNull();
    // The other stop keeps the 40 px circle.
    expect(
      markerHtml("Stopp 1: Trattoria 1").querySelector('[data-testid="stop-marker"] .size-10'),
    ).not.toBeNull();
  });
});

describe("route legs (re-design.md §6)", () => {
  it("draws one path while every leg has the same state", () => {
    renderMap("de");
    expect(routeClasses()).toEqual(["nudel-route"]);
  });

  it("draws delivered legs at the quiet class", () => {
    renderMap("de", {
      stops: [{ ...STOPS[0]!, status: "DELIVERED" }, STOPS[1]!],
      geometry: [
        [16.3, 48.2],
        [16.31, 48.21],
        [16.32, 48.22],
      ],
    });
    expect(routeClasses()).toEqual(["nudel-route nudel-route-done", "nudel-route"]);
  });

  it("maps legs to stops in sequence order and keeps the return leg", () => {
    const groups = routeLegGroups(
      [
        [16.3, 48.2],
        [16.31, 48.21],
        [16.32, 48.22],
      ],
      [{ id: "b", sequence: 2, lat: 48.21, lng: 16.31, status: "DELIVERED" }],
    );
    // Both legs end at (or after) the delivered stop, so they share one 35 % group.
    expect(groups).toHaveLength(1);
    expect(groups[0]!.delivered).toBe(true);
    expect(groups[0]!.positions).toHaveLength(3);
  });

  it("has no legs without geometry", () => {
    expect(routeLegGroups([], STOPS)).toEqual([]);
    expect(routeLegGroups([[16.3, 48.2]], STOPS)).toEqual([]);
  });
});

describe("overlap clustering (re-design.md §6)", () => {
  it("groups markers closer than 28 px and keeps the rest alone", () => {
    const groups = clusterPoints([
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 10, y: 10 }, // 14 px from a -> same badge
      { id: "c", x: 200, y: 0 }, // far -> own marker
    ]);
    expect(groups.map((group) => group.ids)).toEqual([["a", "b"], ["c"]]);
    expect(groups[0]!.x).toBe(5);
    expect(groups[0]!.y).toBe(5);
  });

  it("keeps markers exactly 28 px apart as separate badges", () => {
    const groups = clusterPoints([
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 28, y: 0 },
    ]);
    expect(groups).toHaveLength(2);
  });

  it("renders one cluster badge instead of the overlapping stop markers", () => {
    project.fn = () => ({ x: 5, y: 5 }); // both stops land on the same pixel
    renderMap("de");
    expect(markerTitles()).toEqual(["Depot: Depot", "2 Stopps: Trattoria 1, Trattoria 2"]);
    const cluster = markerByTitle("2 Stopps: Trattoria 1, Trattoria 2");
    expect(cluster.alt).toBe(cluster.title);
    expect(cluster.position).toEqual([48.2, 16.3]);
  });

  it("reports the tapped cluster to the caller", () => {
    project.fn = () => ({ x: 5, y: 5 });
    const onClusterSelect = vi.fn();
    renderMap("de", { onClusterSelect });
    fakeMap.fitBounds.mockClear(); // the initial fit is not the cluster zoom
    markerByTitle("2 Stopps: Trattoria 1, Trattoria 2").eventHandlers!.click!();
    expect(onClusterSelect).toHaveBeenCalledWith(["a", "b"]);
    expect(fakeMap.fitBounds).not.toHaveBeenCalled();
  });

  it("zooms into the cluster on tap when the caller does not open a list", () => {
    project.fn = () => ({ x: 5, y: 5 });
    renderMap("de");
    fakeMap.fitBounds.mockClear();
    markerByTitle("2 Stopps: Trattoria 1, Trattoria 2").eventHandlers!.click!();
    expect(fakeMap.fitBounds).toHaveBeenCalledTimes(1);
  });
});

describe("list <-> map linkage and controls", () => {
  it("reports select and hover callbacks", () => {
    const onSelect = vi.fn();
    const onHover = vi.fn();
    renderMap("de", { onSelect, onHover });
    const handlers = markerByTitle("Stopp 1: Trattoria 1").eventHandlers!;
    handlers.click!();
    handlers.mouseover!();
    handlers.mouseout!();
    expect(onSelect).toHaveBeenCalledWith("a");
    expect(onHover).toHaveBeenCalledWith("a");
    expect(onHover).toHaveBeenLastCalledWith(null);
  });

  it("fits all stops on demand", () => {
    renderMap("de");
    const button = screen.getByRole("button", { name: "Alle Stopps anzeigen" });
    fakeMap.fitBounds.mockClear();
    fireEvent.click(button);
    expect(fakeMap.fitBounds).toHaveBeenCalledTimes(1);
  });

  it("does not fit automatically when fitAll is false", () => {
    renderMap("de", { fitAll: false });
    expect(fakeMap.fitBounds).not.toHaveBeenCalled();
  });
});
