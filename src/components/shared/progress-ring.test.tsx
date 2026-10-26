import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ProgressRing } from "./progress-ring";

describe("ProgressRing", () => {
  afterEach(cleanup);

  it("shows the count inside the ring and names itself with it", () => {
    render(<ProgressRing value={3} max={20} data-testid="ring" />);
    expect(screen.getByTestId("ring")).toHaveTextContent("3/20");
    expect(screen.getByRole("img", { name: "3/20" })).toBeInTheDocument();
  });

  it("uses an explicit label as the accessible name", () => {
    render(<ProgressRing value={3} max={20} label="Fortschritt 3 von 20" />);
    expect(screen.getByRole("img", { name: "Fortschritt 3 von 20" })).toBeInTheDocument();
  });

  it("clamps values outside 0..max instead of overflowing the ring", () => {
    render(<ProgressRing value={40} max={20} />);
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", "20/20");
  });

  it("survives max = 0 without dividing by zero", () => {
    render(<ProgressRing value={0} max={0} />);
    expect(screen.getByRole("img", { name: "0/0" })).toBeInTheDocument();
  });
});
