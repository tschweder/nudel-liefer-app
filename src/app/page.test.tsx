import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Home from "./page";

describe("Home", () => {
  it("renders the placeholder title", () => {
    render(<Home />);
    expect(screen.getByTestId("title")).toHaveTextContent("Nudel Liefer App");
  });
});
