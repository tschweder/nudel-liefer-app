import { cleanup, render, screen } from "@testing-library/react";
import { type AbstractIntlMessages, NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import de from "../../messages/de.json";
import zhHans from "../../messages/zh-Hans.json";
import zhHantHK from "../../messages/zh-Hant-HK.json";
import zhHantTW from "../../messages/zh-Hant-TW.json";
import { AdminNav } from "./admin/admin-nav";
import { AdminShell } from "./admin/admin-shell";
import { ADMIN_SECTIONS } from "./admin/nav-items";
import { SectionPlaceholder } from "./admin/section-placeholder";
import { ConnectionIndicator } from "./driver/connection-indicator";
import { DriverShell } from "./driver/driver-shell";
import { TodayPlaceholder } from "./driver/today-placeholder";
import { EmptyState, ErrorState, LoadingSkeleton } from "./shared/states";

const navigation = vi.hoisted(() => ({ pathname: "/admin" }));

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ replace: vi.fn() }),
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/server/locale-actions", () => ({ setLocaleAction: vi.fn() }));
vi.mock("@/server/auth/actions", () => ({ logoutAction: vi.fn() }));
vi.mock("@/components/auth/logout-button", () => ({
  LogoutButton: () => <button type="button">logout</button>,
}));

const LOCALES: Record<string, AbstractIntlMessages> = {
  de,
  "zh-Hans": zhHans,
  "zh-Hant-HK": zhHantHK,
  "zh-Hant-TW": zhHantTW,
};

/** Any missing message or formatting error fails the test (no silent fallbacks). */
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

describe.each(Object.keys(LOCALES))("shells in %s", (locale) => {
  afterEach(() => {
    cleanup();
    navigation.pathname = "/admin";
  });

  it("renders every admin section placeholder without missing keys", () => {
    for (const section of ADMIN_SECTIONS) {
      renderIn(locale, <SectionPlaceholder section={section} />);
      expect(screen.getByTestId("section-title")).not.toBeEmptyDOMElement();
      expect(screen.getByTestId("empty-state")).toBeInTheDocument();
      cleanup();
    }
  });

  it("renders the admin shell with navigation and header", () => {
    renderIn(
      locale,
      <AdminShell name="Büro" locale={locale}>
        <p>content</p>
      </AdminShell>,
    );
    expect(screen.getByTestId("admin-nav").querySelectorAll("a")).toHaveLength(
      ADMIN_SECTIONS.length,
    );
    expect(screen.getByTestId("user-menu")).toBeInTheDocument();
    expect(screen.getByTestId("language-switcher")).toBeInTheDocument();
    expect(screen.getByText("content")).toBeInTheDocument();
  });

  it("renders the driver shell and the Heute placeholder", () => {
    renderIn(
      locale,
      <DriverShell dateLabel="17.10.">
        <TodayPlaceholder name="Hans" locale={locale} />
      </DriverShell>,
    );
    expect(screen.getByTestId("driver-title")).not.toBeEmptyDOMElement();
    expect(screen.getByTestId("connection-indicator")).toHaveAttribute("data-online", "true");
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
  });

  it("renders the shared states and the connection indicator", () => {
    renderIn(
      locale,
      <>
        <EmptyState />
        <ErrorState />
        <LoadingSkeleton />
        <ConnectionIndicator />
      </>,
    );
    expect(screen.getByTestId("error-state")).toBeInTheDocument();
    expect(screen.getByTestId("loading-skeleton")).toBeInTheDocument();
  });
});

describe("AdminNav active section", () => {
  afterEach(() => {
    cleanup();
    navigation.pathname = "/admin";
  });

  it.each([
    ["/admin", "dashboard"],
    ["/admin/orders", "orders"],
    ["/admin/customers/42", "customers"],
    ["/admin/settings", "settings"],
  ])("marks %s as the current page", (pathname, section) => {
    navigation.pathname = pathname;
    renderIn("de", <AdminNav />);
    const current = screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAttribute("data-testid", `nav-${section}`);
  });
});
