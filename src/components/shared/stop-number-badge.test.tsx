import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { StopNumberBadge } from "./stop-number-badge";

describe("StopNumberBadge", () => {
  afterEach(cleanup);

  it("uses the label as the accessible name, not the bare digit", () => {
    render(
      <StopNumberBadge number={13} label="Stopp 13: Cucina Bella Napoli" data-testid="badge" />,
    );
    const badge = screen.getByLabelText("Stopp 13: Cucina Bella Napoli");
    expect(badge).toHaveAttribute("data-tone", "neutral");
    expect(badge).toHaveClass("border-2");
    // The number must be rendered visibly (regression: it was sr-only and the circle looked empty).
    expect(badge).toHaveTextContent("13");
    expect(badge.textContent).not.toBe("");
    // ... but hidden from the accessibility tree, so the badge is not announced as a bare digit.
    expect(badge.querySelector("span[aria-hidden='true']")).not.toBeNull();
  });

  it("is decorative (hidden from the a11y tree) without a label but still shows the number", () => {
    render(<StopNumberBadge number={3} data-testid="badge" />);
    const badge = screen.getByTestId("badge");
    expect(badge).toHaveAttribute("aria-hidden", "true");
    expect(badge).toHaveTextContent("3");
  });

  it("shows the number, and a check only when done with the success tone", () => {
    const { unmount } = render(<StopNumberBadge number={3} done tone="success" label="Stopp 3" />);
    expect(screen.getByLabelText("Stopp 3").querySelector("svg")).not.toBeNull();
    unmount();

    render(<StopNumberBadge number={3} done tone="primary" label="Stopp 3" />);
    expect(screen.getByLabelText("Stopp 3").querySelector("svg")).toBeNull();
    expect(screen.getByLabelText("Stopp 3")).toHaveTextContent("3");
  });

  it("colours the 48 px variant from the status map and marks the next stop", () => {
    render(<StopNumberBadge number={4} size={48} isNext tone="primary" label="Stopp 4" />);
    const badge = screen.getByLabelText("Stopp 4");
    expect(badge).toHaveClass("size-12");
    expect(badge).toHaveClass("bg-primary-soft");
    expect(badge).toHaveAttribute("data-next", "true");
  });
});
