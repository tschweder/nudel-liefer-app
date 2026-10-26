import { cleanup, render, screen } from "@testing-library/react";
import { Truck as TruckIcon } from "lucide-react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StatTile } from "./stat-tile";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

function renderTile(ui: ReactNode) {
  return render(
    <NextIntlClientProvider locale="de" messages={{}}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("StatTile", () => {
  afterEach(cleanup);

  it("shows label, value and the optional sub line", () => {
    renderTile(
      <StatTile
        label="Heute geliefert"
        value="3/20"
        sub="2 Probleme"
        icon={TruckIcon}
        data-testid="tile"
      />,
    );
    const tile = screen.getByTestId("tile");
    expect(tile).toHaveTextContent("Heute geliefert");
    expect(tile).toHaveTextContent("3/20");
    expect(tile).toHaveTextContent("2 Probleme");
  });

  it("renders a plain tile without an href and a link with one", () => {
    const { unmount } = renderTile(<StatTile label="Probleme" value="0" data-testid="tile" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    unmount();

    renderTile(<StatTile label="Probleme" value="0" href="/admin/orders" data-testid="tile" />);
    const link = screen.getByRole("link", { name: /Probleme/ });
    expect(link).toHaveAttribute("href", "/admin/orders");
  });

  it("uses the tone for the icon circle and tabular figures for the value", () => {
    renderTile(
      <StatTile label="Offen" value="17" tone="warning" icon={TruckIcon} data-testid="tile" />,
    );
    expect(screen.getByTestId("tile").querySelector(".tabular-nums")).not.toBeNull();
    expect(screen.getByTestId("tile").querySelector(".bg-warning-soft")).not.toBeNull();
  });
});
