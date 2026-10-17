import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type AbstractIntlMessages, NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type BeforeInstallPromptEvent,
  INSTALL_HINT_DISMISSED_KEY,
  resetInstallStateForTests,
  setDeferredPrompt,
} from "@/lib/install-prompt";

import de from "../../../messages/de.json";
import zhHans from "../../../messages/zh-Hans.json";
import zhHantHK from "../../../messages/zh-Hant-HK.json";
import zhHantTW from "../../../messages/zh-Hant-TW.json";
import { InstallHint } from "./install-hint";

const LOCALES: Record<string, AbstractIntlMessages> = {
  de,
  "zh-Hans": zhHans,
  "zh-Hant-HK": zhHantHK,
  "zh-Hant-TW": zhHantTW,
};

function renderIn(locale: string) {
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
      <InstallHint />
    </NextIntlClientProvider>,
  );
}

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";

function setUserAgent(ua: string) {
  Object.defineProperty(window.navigator, "userAgent", { value: ua, configurable: true });
}

function fakePromptEvent(outcome: "accepted" | "dismissed") {
  return Object.assign(new Event("beforeinstallprompt"), {
    prompt: vi.fn().mockResolvedValue(undefined),
    userChoice: Promise.resolve({ outcome }),
  }) as unknown as BeforeInstallPromptEvent & { prompt: ReturnType<typeof vi.fn> };
}

const originalUa = window.navigator.userAgent;
beforeEach(() => {
  window.localStorage.clear();
  resetInstallStateForTests();
  window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof matchMedia;
});
afterEach(() => {
  cleanup();
  setUserAgent(originalUa);
  vi.restoreAllMocks();
});

describe.each(Object.keys(LOCALES))("InstallHint (%s)", (locale) => {
  it("shows nothing on a desktop browser without an install offer", () => {
    renderIn(locale);
    expect(screen.queryByTestId("install-hint")).toBeNull();
  });

  it("Android: install button appears with beforeinstallprompt and calls prompt()", async () => {
    renderIn(locale);
    const event = fakePromptEvent("accepted");
    act(() => setDeferredPrompt(event));
    expect(screen.getByTestId("install-hint")).toHaveAttribute("data-kind", "android");
    fireEvent.click(screen.getByTestId("install-button"));
    await waitFor(() => expect(event.prompt).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId("install-hint")).toBeNull());
  });

  it("iOS: shows the hint, the overlay explains Share -> Add to Home Screen", () => {
    setUserAgent(IPHONE_UA);
    renderIn(locale);
    expect(screen.getByTestId("install-hint")).toHaveAttribute("data-kind", "ios");
    fireEvent.click(screen.getByTestId("install-how"));
    expect(screen.getByTestId("install-overlay")).toBeInTheDocument();
    expect(screen.getByTestId("install-illustration")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("dismissing hides the hint and remembers it", () => {
    setUserAgent(IPHONE_UA);
    const first = renderIn(locale);
    fireEvent.click(screen.getByTestId("install-dismiss"));
    expect(screen.queryByTestId("install-hint")).toBeNull();
    expect(window.localStorage.getItem(INSTALL_HINT_DISMISSED_KEY)).toBe("1");
    first.unmount();
    resetInstallStateForTests(); // a new page load reads the stored flag
    renderIn(locale);
    expect(screen.queryByTestId("install-hint")).toBeNull();
  });

  it("is hidden inside the installed app (standalone)", () => {
    setUserAgent(IPHONE_UA);
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof matchMedia;
    renderIn(locale);
    expect(screen.queryByTestId("install-hint")).toBeNull();
  });
});
