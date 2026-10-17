import { cleanup, render, screen, within } from "@testing-library/react";
import { type AbstractIntlMessages, NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TodayProgress } from "@/server/tour-progress";

import de from "../../../messages/de.json";
import zhHans from "../../../messages/zh-Hans.json";
import zhHantHK from "../../../messages/zh-Hant-HK.json";
import zhHantTW from "../../../messages/zh-Hant-TW.json";
import { TodayCard } from "./today-card";

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const LOCALES: Record<string, AbstractIntlMessages> = {
  de,
  "zh-Hans": zhHans,
  "zh-Hant-HK": zhHantHK,
  "zh-Hant-TW": zhHantTW,
};

const progress = {
  total: 8,
  delivered: 2,
  problems: 1,
  done: 3,
  pending: 5,
  percent: 38,
  nextStopId: "s4",
};
const live: TodayProgress = {
  date: "2099-07-02",
  timezone: "Europe/Vienna",
  tour: {
    id: "t1",
    status: "IN_PROGRESS",
    driverName: "Hans",
    progress,
    nextStop: {
      id: "s4",
      name: "Trattoria Roma",
      street: "Hauptstraße 1",
      postalCode: "1010",
      city: "Wien",
      etaAt: "2099-07-02T08:30:00Z",
    },
    problemStops: [{ id: "s2", name: "Pizzeria Napoli", reason: "CLOSED" }],
  },
};

function renderIn(locale: string, today: TodayProgress) {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={LOCALES[locale]}
      onError={(error) => {
        throw error;
      }}
    >
      <TodayCard today={today} pollIntervalMs={30_000} />
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);

describe.each(Object.keys(LOCALES))("TodayCard (%s)", (locale) => {
  it("shows progress, next stop and the problems count", () => {
    renderIn(locale, live);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "3");
    expect(bar).toHaveAttribute("aria-valuemax", "8");
    expect(screen.getByTestId("today-progress").textContent).toContain("3");
    expect(screen.getByTestId("today-next-name")).toHaveTextContent("Trattoria Roma");
    expect(screen.getByTestId("today-problem-count").textContent).toContain("1");
    expect(
      within(screen.getByTestId("today-problems")).getByTestId("today-problem"),
    ).toHaveTextContent("Pizzeria Napoli");
    expect(screen.getByTestId("live-refresh")).toHaveAttribute("data-interval-ms", "30000");
    expect(screen.getByTestId("today-link")).toHaveAttribute(
      "href",
      "/admin/tours?date=2099-07-02",
    );
  });

  it("says so when everything is done, and keeps polling off for a completed tour", () => {
    renderIn(locale, {
      ...live,
      tour: {
        ...live.tour!,
        status: "COMPLETED",
        nextStop: null,
        progress: { ...progress, done: 8, pending: 0, percent: 100, nextStopId: null },
      },
    });
    expect(screen.getByTestId("today-all-done")).toBeInTheDocument();
    expect(screen.queryByTestId("today-next-name")).toBeNull();
  });

  it("explains a missing or unreleased tour", () => {
    renderIn(locale, { ...live, tour: null });
    expect(screen.getByTestId("today-no-tour")).toBeInTheDocument();
    cleanup();
    renderIn(locale, { ...live, tour: { ...live.tour!, status: "OPTIMIZED" } });
    expect(screen.getByTestId("today-not-released")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});
