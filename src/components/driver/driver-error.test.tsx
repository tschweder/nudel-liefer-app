import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type AbstractIntlMessages, NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import de from "../../../messages/de.json";
import zhHans from "../../../messages/zh-Hans.json";
import zhHantHK from "../../../messages/zh-Hant-HK.json";
import zhHantTW from "../../../messages/zh-Hant-TW.json";
import { DriverError } from "./driver-error";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
const report = vi.fn();
vi.mock("@/lib/monitoring-client", () => ({ reportClientError: (e: unknown) => report(e) }));

const LOCALES: Record<string, AbstractIntlMessages> = {
  de,
  "zh-Hans": zhHans,
  "zh-Hant-HK": zhHantHK,
  "zh-Hant-TW": zhHantTW,
};

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => value });
}

function renderIn(locale: string, reset = vi.fn(), error = new Error("boom")) {
  render(
    <NextIntlClientProvider
      locale={locale}
      messages={LOCALES[locale]}
      onError={(e) => {
        throw e;
      }}
      getMessageFallback={({ namespace, key }) => {
        throw new Error(`missing message ${namespace}.${key}`);
      }}
    >
      <DriverError error={error} reset={reset} />
    </NextIntlClientProvider>,
  );
  return reset;
}

describe("DriverError", () => {
  beforeEach(() => {
    refresh.mockClear();
    report.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => {});
    setOnline(true);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it.each(Object.keys(LOCALES))(
    "shows the friendly message with a retry button in %s",
    (locale) => {
      const reset = renderIn(locale);
      const root = screen.getByTestId("driver-error");
      expect(root).toHaveAttribute("data-connection", "online");
      const messages = (LOCALES[locale] as { errorPages: { driver: Record<string, string> } })
        .errorPages.driver;
      expect(root).toHaveTextContent(messages.title!);
      expect(root).toHaveTextContent(messages.description!);
      // Never the technical message.
      expect(root).not.toHaveTextContent("boom");
      fireEvent.click(screen.getByTestId("driver-error-retry"));
      expect(reset).toHaveBeenCalledTimes(1);
      expect(refresh).toHaveBeenCalledTimes(1);
    },
  );

  it("promises that the data is safe (German and Chinese wording)", () => {
    expect(de.errorPages.driver.description).toMatch(/sicher/);
    expect(zhHans.errorPages.driver.description).toMatch(/安全/);
  });

  it("offline: no error wording, and the button makes a full page load for the offline shell", () => {
    setOnline(false);
    const reload = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload },
    });
    const reset = renderIn("de");
    const root = screen.getByTestId("driver-error");
    expect(root).toHaveAttribute("data-connection", "offline");
    expect(root).toHaveTextContent(de.errorPages.driver.offlineTitle);
    expect(root).not.toHaveTextContent(de.errorPages.driver.title);
    fireEvent.click(screen.getByTestId("driver-error-retry"));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(reset).not.toHaveBeenCalled();
  });

  it("offline: reloads by itself when the connection returns", () => {
    setOnline(false);
    const reload = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload },
    });
    renderIn("zh-Hans");
    expect(reload).not.toHaveBeenCalled();
    act(() => {
      setOnline(true);
      window.dispatchEvent(new Event("online"));
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reports the error once and has a link back to the tour", () => {
    const error = new Error("boom");
    renderIn("de", vi.fn(), error);
    expect(report).toHaveBeenCalledWith(error);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/driver");
  });
});
