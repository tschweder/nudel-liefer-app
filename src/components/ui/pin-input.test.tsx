import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PinInput } from "./pin-input";

/** Controlled wrapper: the component itself stays a pure controlled input. */
function Host({
  onChange,
  ...props
}: Omit<React.ComponentProps<typeof PinInput>, "value" | "onChange"> & {
  onChange?: (value: string) => void;
}) {
  const [value, setValue] = React.useState("");
  return (
    <form>
      <PinInput
        {...props}
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange?.(next);
        }}
      />
      <button type="submit">Anmelden</button>
    </form>
  );
}

function input() {
  return screen.getByLabelText("PIN") as HTMLInputElement;
}

describe("PinInput", () => {
  afterEach(cleanup);

  it("keeps the caller's name, accessible name, test id and numeric hints on the real input", () => {
    render(<Host name="pin" aria-label="PIN" data-testid="pin-input" />);
    const field = input();
    expect(field).toHaveAttribute("name", "pin");
    expect(field).toHaveAttribute("data-testid", "pin-input");
    expect(field).toHaveAttribute("inputmode", "numeric");
    expect(field).toHaveAttribute("autocomplete", "one-time-code");
    expect(field).toHaveAttribute("maxlength", "6");
    expect(field).toHaveAttribute("type", "password");
  });

  it("renders six cells and reports the typed digits", () => {
    const onChange = vi.fn();
    render(<Host name="pin" aria-label="PIN" onChange={onChange} />);
    const cells = document.querySelectorAll("[data-slot=pin-cell]");
    expect(cells).toHaveLength(6);

    fireEvent.change(input(), { target: { value: "482916" } });
    expect(onChange).toHaveBeenLastCalledWith("482916");
    expect(input().value).toBe("482916");
    expect(cells[0]).toHaveTextContent("4");
    expect(cells[5]).toHaveTextContent("6");
  });

  it("strips non-digits and truncates to six", () => {
    const onChange = vi.fn();
    render(<Host name="pin" aria-label="PIN" onChange={onChange} />);
    fireEvent.change(input(), { target: { value: "12a3-45678" } });
    expect(onChange).toHaveBeenLastCalledWith("123456");
  });

  it("supports pasting a six-digit code", () => {
    const onChange = vi.fn();
    render(<Host name="pin" aria-label="PIN" onChange={onChange} />);
    fireEvent.paste(input(), { clipboardData: { getData: () => " 482 916 " } });
    expect(onChange).toHaveBeenLastCalledWith("482916");
    expect(input().value).toBe("482916");
  });

  it("ignores a paste without digits", () => {
    const onChange = vi.fn();
    render(<Host name="pin" aria-label="PIN" onChange={onChange} />);
    fireEvent.paste(input(), { clipboardData: { getData: () => "kein code" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("removes the last digit on Backspace", () => {
    const onChange = vi.fn();
    render(<Host name="pin" aria-label="PIN" onChange={onChange} />);
    fireEvent.change(input(), { target: { value: "4829" } });
    onChange.mockClear();
    fireEvent.keyDown(input(), { key: "Backspace" });
    expect(onChange).toHaveBeenLastCalledWith("482");
  });

  it("forwards aria-invalid and aria-describedby for the form wrapper", () => {
    render(<Host name="pin" aria-label="PIN" invalid aria-describedby="pin-error" />);
    expect(input()).toHaveAttribute("aria-invalid", "true");
    expect(input()).toHaveAttribute("aria-describedby", "pin-error");
    expect(document.querySelector("[data-slot=pin-cell]")).toHaveClass("border-destructive");
  });

  it("submits the digits with the form", () => {
    render(<Host name="pin" aria-label="PIN" />);
    fireEvent.change(input(), { target: { value: "482916" } });
    const form = input().closest("form")!;
    const data = new FormData(form);
    expect(data.get("pin")).toBe("482916");
  });
});
