import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { type AbstractIntlMessages, NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DriverToday, TodayStop } from "@/server/driver-today";

import de from "../../../messages/de.json";
import zhHans from "../../../messages/zh-Hans.json";
import zhHantHK from "../../../messages/zh-Hant-HK.json";
import zhHantTW from "../../../messages/zh-Hant-TW.json";
import { TodayTour } from "./today-tour";

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/maps/lazy", () => ({ TourMapLazy: () => <div data-testid="tour-map" /> }));

const LOCALES: Record<string, AbstractIntlMessages> = {
  de,
  "zh-Hans": zhHans,
  "zh-Hant-HK": zhHantHK,
  "zh-Hant-TW": zhHantTW,
};
const TILES = { url: "x", attribution: "" };

function renderIn(locale: string, ui: ReactNode) {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={LOCALES[locale]}
      onError={(error) => {
        throw error;
      }}
      getMessageFallback={({ namespace, key }) => {
        throw new Error(`missing message ${namespace}.${key}`);
      }}
    >
      {ui}
    </NextIntlClientProvider>,
  );
}

const stop = (sequence: number, extra: Partial<TodayStop> = {}): TodayStop => ({
  id: `s${sequence}`,
  sequence,
  status: "PENDING",
  etaAt: `2099-07-02T0${5 + sequence}:15:00Z`,
  legDurationS: 600,
  change: null,
  changedInRevision: null,
  customerId: `c${sequence}`,
  customerNumber: `K${sequence}`,
  customerName: `Trattoria ${sequence}`,
  street: "Hauptstraße 1",
  postalCode: "1010",
  city: "Wien",
  lat: 48.2,
  lng: Number((16.3 + sequence / 100).toFixed(2)),
  items: [
    {
      productId: "a",
      name: "Spaghetti",
      germanName: null,
      unit: "KG",
      quantityCents: 1250,
      previousQuantityCents: null,
    },
    {
      productId: "b",
      name: "Penne",
      germanName: null,
      unit: "PACK",
      quantityCents: 400,
      previousQuantityCents: null,
    },
  ],
  ...extra,
});

const today = (stops: TodayStop[], extra: Partial<DriverToday> = {}): DriverToday => ({
  tourId: "t1",
  date: "2099-07-02",
  tourStatus: "IN_PROGRESS",
  revision: 1,
  updated: false,
  removedCustomers: [],
  stops,
  depot: null,
  geometry: null,
  serviceSecondsPerStop: 600,
  timezone: "Europe/Vienna",
  ...extra,
});

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe.each(Object.keys(LOCALES))("TodayTour in %s", (locale) => {
  it("shows the lowest-sequence pending stop as next, with a per-unit summary and a pinned Navigate link", () => {
    renderIn(
      locale,
      <TodayTour
        today={today([
          stop(1, { status: "DELIVERED" }),
          stop(2, { status: "PROBLEM" }),
          stop(4),
          stop(3),
        ])}
        tiles={TILES}
      />,
    );
    const next = screen.getByTestId("next-stop");
    expect(within(next).getByTestId("next-stop-name")).toHaveTextContent("Trattoria 3");
    expect(within(next).getByTestId("stop-number")).toHaveTextContent("3");
    expect(screen.getByTestId("progress-count")).toHaveTextContent("2 / 4");
    const totals = within(next).getAllByTestId("summary-total");
    expect(totals.map((el) => el.dataset.unit)).toEqual(["KG", "PACK"]);
    expect(totals[0]).toHaveTextContent(/12[.,]5/);
    expect(within(next).getByTestId("navigate")).toHaveAttribute(
      "href",
      "https://www.google.com/maps/dir/?api=1&destination=48.2,16.33&travelmode=driving",
    );
    expect(within(next).getByTestId("details")).toHaveAttribute("href", "/driver/stops/s3");
    expect(screen.getAllByTestId("stop-row")).toHaveLength(4);
    expect(screen.queryByTestId("updated-banner")).toBeNull();
  });

  it("shows the all-done card when nothing is pending", () => {
    renderIn(locale, <TodayTour today={today([stop(1, { status: "DELIVERED" })])} tiles={TILES} />);
    expect(screen.getByTestId("all-done")).toBeInTheDocument();
    expect(screen.queryByTestId("next-stop")).toBeNull();
  });

  it("shows the updated banner and highlights until acknowledged", () => {
    const changed = stop(2, {
      change: "CHANGED",
      changedInRevision: 2,
      items: [
        {
          productId: "a",
          name: "Spaghetti",
          germanName: null,
          unit: "KG",
          quantityCents: 500,
          previousQuantityCents: 300,
        },
      ],
    });
    renderIn(
      locale,
      <TodayTour
        today={today([stop(1), changed, stop(3, { change: "ADDED", changedInRevision: 2 })], {
          revision: 2,
          updated: true,
          removedCustomers: [{ customerId: "c9", customerNumber: "K9", name: "Gone GmbH" }],
        })}
        tiles={TILES}
      />,
    );
    expect(screen.getByTestId("updated-banner")).toBeInTheDocument();
    expect(screen.getByTestId("removed-stops")).toHaveTextContent("Gone GmbH");
    const highlights = screen.getAllByTestId("stop-change");
    expect(highlights.map((el) => el.dataset.change)).toEqual(["CHANGED", "ADDED"]);
    expect(screen.getByTestId("change-item")).toHaveTextContent(/3.*→.*5/);

    fireEvent.click(screen.getByTestId("updated-ack"));
    expect(screen.queryByTestId("updated-banner")).toBeNull();
    expect(screen.queryAllByTestId("stop-change")).toHaveLength(0);
    expect(window.localStorage.getItem("nudel.driver.seenRevision.t1")).toBe("2");
  });

  it("does not show the banner for a revision the device has already seen", () => {
    window.localStorage.setItem("nudel.driver.seenRevision.t1", "2");
    renderIn(
      locale,
      <TodayTour
        today={today([stop(1, { change: "CHANGED", changedInRevision: 2 })], {
          revision: 2,
          updated: true,
        })}
        tiles={TILES}
      />,
    );
    expect(screen.queryByTestId("updated-banner")).toBeNull();
    expect(screen.queryByTestId("stop-change")).toBeNull();
  });

  it("toggles between list and map", () => {
    renderIn(locale, <TodayTour today={today([stop(1)])} tiles={TILES} />);
    expect(screen.getByTestId("stop-list")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("view-map"));
    expect(screen.getByTestId("tour-map")).toBeInTheDocument();
    expect(screen.queryByTestId("stop-list")).toBeNull();
    expect(screen.getByTestId("view-map")).toHaveAttribute("aria-pressed", "true");
  });

  it("offers no Navigate link without a confirmed pin", () => {
    renderIn(
      locale,
      <TodayTour today={today([stop(1, { lat: null, lng: null })])} tiles={TILES} />,
    );
    expect(screen.queryByTestId("navigate")).toBeNull();
    expect(screen.getByTestId("no-pin")).toBeInTheDocument();
  });
});
