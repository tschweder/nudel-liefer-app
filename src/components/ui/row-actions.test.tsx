import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DropdownMenuItem } from "./dropdown-menu";
import { RowActions } from "./row-actions";

describe("RowActions", () => {
  afterEach(cleanup);

  it("labels the icon-only trigger", () => {
    render(
      <RowActions label="Aktionen für Bestellung 4711">
        <DropdownMenuItem>Bearbeiten</DropdownMenuItem>
      </RowActions>,
    );
    const trigger = screen.getByRole("button", { name: "Aktionen für Bestellung 4711" });
    expect(trigger).toBeInTheDocument();
    expect(trigger.querySelector("svg")).not.toBeNull();
    expect(trigger.textContent?.trim()).toBe("");
  });

  it("opens the menu with the children on click", () => {
    const onSelect = vi.fn();
    render(
      <RowActions label="Aktionen">
        <DropdownMenuItem onSelect={onSelect}>Bearbeiten</DropdownMenuItem>
      </RowActions>,
    );
    const trigger = screen.getByRole("button", { name: "Aktionen" });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);

    const item = screen.getByRole("menuitem", { name: "Bearbeiten" });
    fireEvent.click(item);
    expect(onSelect).toHaveBeenCalled();
  });
});
