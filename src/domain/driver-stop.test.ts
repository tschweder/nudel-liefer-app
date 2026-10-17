import { describe, expect, it } from "vitest";

import { formatAddress, neighbourStops } from "./driver-stop";

const stops = [
  { id: "c", sequence: 3 },
  { id: "a", sequence: 1 },
  { id: "b", sequence: 2 },
];

describe("neighbourStops", () => {
  it("returns neighbours in sequence order for unordered input", () => {
    const r = neighbourStops(stops, "b")!;
    expect(r.prev?.id).toBe("a");
    expect(r.next?.id).toBe("c");
    expect([r.position, r.total]).toEqual([2, 3]);
  });
  it("has no previous stop at the start and no next stop at the end", () => {
    expect(neighbourStops(stops, "a")!.prev).toBeNull();
    expect(neighbourStops(stops, "c")!.next).toBeNull();
  });
  it("is null for an unknown stop", () => {
    expect(neighbourStops(stops, "x")).toBeNull();
  });
});

describe("formatAddress", () => {
  it("joins street, postal code and city", () => {
    expect(formatAddress({ street: "Hauptstr. 1", postalCode: "1010", city: "Wien" })).toBe(
      "Hauptstr. 1, 1010 Wien",
    );
  });
});
