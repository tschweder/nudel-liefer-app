import { cleanup, render, screen } from "@testing-library/react";
import { type AbstractIntlMessages, NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import de from "../../../messages/de.json";
import zhHans from "../../../messages/zh-Hans.json";
import zhHantHK from "../../../messages/zh-Hant-HK.json";
import zhHantTW from "../../../messages/zh-Hant-TW.json";
import { DriverShell } from "./driver-shell";

/**
 * The driver top bar (re-design.md §7.1/§7.6): date, sync chip, language select and overflow, plus
 * the accessible markers the e2e specs query (`connection-indicator`, `pending-badge`,
 * `offline-ready`). The offline store is mocked; the marker state is what is under test.
 */
const state = vi.hoisted(() => ({
  online: true,
  offline: {
    phase: "ready",
    syncing: false,
    savedAt: "2099-07-02T05:12:00.000Z",
    timezone: "Europe/Vienna",
    photos: { total: 3, cached: 3 },
  } as Record<string, unknown>,
  entries: [] as unknown[],
  notices: [] as unknown[],
}));

vi.mock("@/lib/offline/use-online", () => ({ useOnline: () => state.online }));
vi.mock("@/lib/offline/browser", () => ({ useOfflineStatus: () => state.offline }));
vi.mock("@/lib/offline/outbox-browser", () => ({
  useOutbox: () => ({ entries: state.entries, notices: state.notices, failure: null }),
  getOutbox: () => ({ flush: vi.fn(), dismissNotice: vi.fn() }),
}));
vi.mock("@/lib/offline/photo-outbox-browser", () => ({
  usePhotoOutbox: () => ({ entries: [] }),
}));
vi.mock("@/lib/offline/outbox-controller", () => ({}));
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/driver",
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/server/locale-actions", () => ({ setLocaleAction: vi.fn() }));

const MESSAGES: Record<string, AbstractIntlMessages> = {
  de,
  "zh-Hans": zhHans,
  "zh-Hant-HK": zhHantHK,
  "zh-Hant-TW": zhHantTW,
};

function show(locale: keyof typeof MESSAGES) {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={MESSAGES[locale]}
      onError={(error) => {
        throw error;
      }}
      getMessageFallback={({ namespace, key }) => {
        throw new Error(`missing message ${namespace}.${key}`);
      }}
    >
      <DriverShell dateLabel="17. Okt.">content</DriverShell>
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  state.online = true;
  state.offline = { ...state.offline, phase: "ready", savedAt: "2099-07-02T05:12:00.000Z" };
  state.entries = [];
});

describe.each(Object.keys(MESSAGES))("DriverShell in %s", (locale) => {
  it("renders the date, the sync chip, the language select and the overflow", () => {
    show(locale);
    expect(screen.getByTestId("driver-date")).toHaveTextContent("17. Okt.");
    expect(screen.getByTestId("sync-chip")).toBeInTheDocument();
    expect(screen.getByTestId("language-switcher")).toBeInTheDocument();
    expect(screen.getByTestId("driver-menu")).toBeInTheDocument();
    expect(screen.getByTestId("connection-indicator")).toHaveAttribute("data-online", "true");
  });

  it("keeps the 'offline ready' text in the chip's marker instead of its own line", () => {
    show(locale);
    const ready = screen.getByTestId("offline-ready");
    expect(ready).toBeInTheDocument();
    expect(ready).toHaveTextContent(/\S/);
    cleanup();
    state.offline = { ...state.offline, phase: "partial", photos: { total: 3, cached: 1 } };
    show(locale);
    expect(screen.queryByTestId("offline-ready")).toBeNull();
  });

  it("reports the offline state through the chip and the count through the badge", () => {
    state.online = false;
    state.entries = [
      {
        clientMutationId: "a",
        userId: "u",
        type: "delivered",
        stopId: "s1",
        createdAt: "2099-07-02T06:12:00.000Z",
        seq: 1,
        customerName: "Trattoria 1",
      },
    ];
    show(locale);
    expect(screen.getByTestId("connection-indicator")).toHaveAttribute("data-online", "false");
    expect(screen.getByTestId("sync-chip")).toHaveAttribute("data-state", "pending");
    expect(screen.getByTestId("pending-badge")).toHaveAttribute("data-count", "1");
  });
});
