import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LatLng } from "@/lib/coords";

import { LatLngInputs } from "./lat-lng-inputs";

const labels = {
  legend: "Coordinates",
  latitude: "Latitude",
  longitude: "Longitude",
  invalid: "Invalid",
};

afterEach(cleanup);

describe("LatLngInputs", () => {
  it("shows the pin and follows outside changes", () => {
    const { rerender } = render(
      <LatLngInputs value={{ lat: 48.2, lng: 16.3 }} onChange={() => {}} labels={labels} />,
    );
    expect(screen.getByLabelText("Latitude")).toHaveValue("48.2");
    rerender(<LatLngInputs value={{ lat: 47.1, lng: 15.4 }} onChange={() => {}} labels={labels} />);
    expect(screen.getByLabelText("Latitude")).toHaveValue("47.1");
    expect(screen.getByLabelText("Longitude")).toHaveValue("15.4");
  });

  it("emits rounded coordinates once both fields are valid (comma accepted)", () => {
    const onChange = vi.fn();
    render(<LatLngInputs value={null} onChange={onChange} labels={labels} />);
    fireEvent.change(screen.getByLabelText("Latitude"), { target: { value: "48,2082123456" } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Longitude"), { target: { value: "16.3738" } });
    expect(onChange).toHaveBeenLastCalledWith({ lat: 48.208212, lng: 16.3738 });
  });

  it("flags out-of-range values and does not emit them", () => {
    const onChange = vi.fn();
    render(<LatLngInputs value={{ lat: 48.2, lng: 16.3 }} onChange={onChange} labels={labels} />);
    fireEvent.change(screen.getByLabelText("Latitude"), { target: { value: "95" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Invalid");
    expect(screen.getByLabelText("Latitude")).toHaveAttribute("aria-invalid", "true");
  });

  it("does not rewrite what the user is typing after emitting", () => {
    function Harness() {
      const [value, setValue] = useState<LatLng | null>({ lat: 48.2, lng: 16.3 });
      return <LatLngInputs value={value} onChange={setValue} labels={labels} />;
    }
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Latitude"), { target: { value: "48." } });
    expect(screen.getByLabelText("Latitude")).toHaveValue("48.");
  });
});
