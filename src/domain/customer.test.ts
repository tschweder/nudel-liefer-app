import { describe, expect, it } from "vitest";

import {
  addressChanged,
  canConfirmPin,
  resolvePinConfirmed,
  suggestNextCustomerNumber,
} from "./customer";

const addr = { street: "Hauptstraße 1", postalCode: "1010", city: "Wien", country: "AT" };
const pin = { lat: 48.2, lng: 16.37 };

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

describe("pin confirmation", () => {
  const before = { address: addr, pin };
  it("needs a pin", () => {
    expect(canConfirmPin(null, { address: addr, pin: null })).toBe(false);
    expect(resolvePinConfirmed(true, null, { address: addr, pin: null })).toBe(false);
  });
  it("is allowed for a new customer with a pin", () => {
    expect(resolvePinConfirmed(true, null, { address: addr, pin })).toBe(true);
    expect(resolvePinConfirmed(false, null, { address: addr, pin })).toBe(false);
  });
  it("is kept when only the name or notes change (address unchanged)", () => {
    expect(resolvePinConfirmed(true, before, { address: addr, pin })).toBe(true);
  });
  it("is reset when the street changes and the pin stays", () => {
    const after = { address: { ...addr, street: "Nebenstraße 5" }, pin };
    expect(canConfirmPin(before, after)).toBe(false);
    expect(resolvePinConfirmed(true, before, after)).toBe(false);
  });
  it("can be given again once the pin moved after an address change", () => {
    const after = {
      address: { ...addr, street: "Nebenstraße 5" },
      pin: { lat: 48.21, lng: 16.37 },
    };
    expect(resolvePinConfirmed(true, before, after)).toBe(true);
  });
  it("a customer without a stored pin can be confirmed after setting one", () => {
    expect(
      resolvePinConfirmed(
        true,
        { address: addr, pin: null },
        { address: { ...addr, city: "X" }, pin },
      ),
    ).toBe(true);
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
