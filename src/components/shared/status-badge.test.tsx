import { cleanup, render, screen } from "@testing-library/react";
import { CircleCheckIcon } from "lucide-react";
import { afterEach, describe, expect, it } from "vitest";

import { StatusBadge } from "./status-badge";

describe("StatusBadge", () => {
  afterEach(cleanup);

  it("renders the label together with the colour and the tone as data", () => {
    render(<StatusBadge tone="success">Geliefert</StatusBadge>);
    const badge = screen.getByText("Geliefert").closest("[data-slot=status-badge]")!;
    expect(badge).toHaveAttribute("data-tone", "success");
    expect(badge).toHaveClass("bg-success-soft", "text-success-soft-foreground");
    // Status is never colour alone: without an explicit icon a dot is rendered as well.
    expect(badge.querySelector("span[aria-hidden]")).not.toBeNull();
  });

  it("renders the passed icon instead of the dot and hides it from assistive tech", () => {
    render(
      <StatusBadge tone="warning" icon={CircleCheckIcon}>
        Problem
      </StatusBadge>,
    );
    const badge = screen.getByText("Problem").closest("[data-slot=status-badge]")!;
    const svg = badge.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("aria-hidden");
    // No extra dot when an icon is present.
    expect(badge.querySelector("span[aria-hidden]")).toBeNull();
  });

  it("applies the soft background of its tone", () => {
    render(<StatusBadge tone="destructive">Storniert</StatusBadge>);
    const badge = screen.getByText("Storniert").closest("[data-slot=status-badge]")!;
    expect(badge).toHaveClass("bg-destructive-soft");
  });

  it("supports the three sizes", () => {
    const { rerender } = render(
      <StatusBadge tone="info" size="sm">
        Klein
      </StatusBadge>,
    );
    const small = screen.getByText("Klein").closest("[data-slot=status-badge]")!;
    expect(small).toHaveClass("text-xs");
    rerender(
      <StatusBadge tone="info" size="lg">
        Gross
      </StatusBadge>,
    );
    const large = screen.getByText("Gross").closest("[data-slot=status-badge]")!;
    expect(large).toHaveClass("text-base");
  });

  it("forwards a custom class name", () => {
    render(
      <StatusBadge tone="primary" className="ms-auto">
        Offen
      </StatusBadge>,
    );
    const badge = screen.getByText("Offen").closest("[data-slot=status-badge]")!;
    expect(badge).toHaveClass("ms-auto");
  });
});
