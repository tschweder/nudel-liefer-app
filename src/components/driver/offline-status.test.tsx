import { act, cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import de from "../../../messages/de.json";
import zhHans from "../../../messages/zh-Hans.json";
import zhHantHK from "../../../messages/zh-Hant-HK.json";
import zhHantTW from "../../../messages/zh-Hant-TW.json";
import { OfflineStatusBar } from "./offline-status";

const state = vi.hoisted(() => ({
  status: {
    phase: "ready",
    syncing: false,
    savedAt: "2099-07-02T05:12:00.000Z",
    timezone: "Europe/Vienna",
    photos: { total: 3, cached: 3 },
  } as Record<string, unknown>,
  online: true,
}));
vi.mock("@/lib/offline/browser", () => ({ useOfflineStatus: () => state.status }));
vi.mock("@/lib/offline/use-online", () => ({ useOnline: () => state.online }));

const MESSAGES = { de, "zh-Hans": zhHans, "zh-Hant-HK": zhHantHK, "zh-Hant-TW": zhHantTW };

function show(locale: keyof typeof MESSAGES, status: Record<string, unknown>, online: boolean) {
  state.status = { ...state.status, ...status };
  state.online = online;
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={MESSAGES[locale]}
      onError={(e) => {
        throw e;
      }}
    >
      <OfflineStatusBar />
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);

describe("OfflineStatusBar", () => {
  for (const locale of Object.keys(MESSAGES) as Array<keyof typeof MESSAGES>) {
    it(`shows ready / partial / offline in ${locale}`, () => {
      // "ready offline" moved into the SyncStatusChip marker (re-design.md §7.6): no extra line.
      show(locale, { phase: "ready" }, true);
      expect(screen.queryByTestId("offline-ready")).toBeNull();
      expect(screen.queryByTestId("offline-bar")).toBeNull();
      cleanup();
      show(locale, { phase: "partial", photos: { total: 3, cached: 1 } }, true);
      expect(screen.getByTestId("offline-partial").textContent).toMatch(/1/);
      expect(screen.queryByTestId("offline-ready")).toBeNull();
      cleanup();
      show(locale, { phase: "ready", photos: { total: 3, cached: 3 } }, false);
      // 05:12 UTC = 07:12 in Vienna (summer time): "last updated" uses the factory time zone.
      expect(screen.getByTestId("offline-bar").textContent).toMatch(/7[.:]12/);
    });
  }

  it("never claims readiness without a stored copy and says so while offline", () => {
    show("de", { phase: "idle", savedAt: null }, true);
    expect(screen.queryByTestId("offline-ready")).toBeNull();
    cleanup();
    show("de", { phase: "idle", savedAt: null }, false);
    expect(screen.getByTestId("offline-bar").textContent).toContain("keine gespeicherte Tour");
    act(() => {});
  });
});
