import { describe, expect, it } from "vitest";

import { addressChanged, suggestNextCustomerNumber } from "./customer";

const addr = { street: "Hauptstraße 1", postalCode: "1010", city: "Wien", country: "AT" };

describe("addressChanged", () => {
  it("ignores case and whitespace", () => {
    expect(addressChanged(addr, { ...addr, street: "  hauptstraße   1 " })).toBe(false);
  });
  it.each([
    ["street", { street: "Hauptstraße 2" }],
    ["postal code", { postalCode: "1020" }],
    ["city", { city: "Graz" }],
    ["country", { country: "DE" }],
  ])("detects a changed %s", (_n, change) => {
    expect(addressChanged(addr, { ...addr, ...change })).toBe(true);
  });
});

describe("suggestNextCustomerNumber", () => {
  it("starts at 1001 without numbers", () => {
    expect(suggestNextCustomerNumber([])).toBe("1001");
    expect(suggestNextCustomerNumber(["abc"])).toBe("1001");
  });
  it("increments the highest numeric number", () => {
    expect(suggestNextCustomerNumber(["1001", "1041", "1002"])).toBe("1042");
  });
  it("keeps prefix and zero padding", () => {
    expect(suggestNextCustomerNumber(["K-0098", "K-0099", "K-0007"])).toBe("K-0100");
  });
  it("compares numerically, not as text", () => {
    expect(suggestNextCustomerNumber(["9", "10"])).toBe("11");
  });
});
