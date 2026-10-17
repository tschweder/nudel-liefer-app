import { describe, expect, it } from "vitest";

import { DepotNotSetError, getDepot, isoWeekday, nextDeliveryDate, requireDepot } from "./settings";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const MON_FRI = { timezone: "Europe/Vienna", deliveryWeekdays: [1, 2, 3, 4, 5] };

describe("nextDeliveryDate", () => {
  it("takes the next day on a normal weekday", () => {
    // Wed 2026-10-14 10:00 Vienna
    expect(iso(nextDeliveryDate(new Date("2026-10-14T08:00:00Z"), MON_FRI))).toBe("2026-10-15");
  });

  it("skips the weekend", () => {
    // Fri 2026-10-16 -> Mon 2026-10-19; Sat and Sun too
    expect(iso(nextDeliveryDate(new Date("2026-10-16T08:00:00Z"), MON_FRI))).toBe("2026-10-19");
    expect(iso(nextDeliveryDate(new Date("2026-10-17T08:00:00Z"), MON_FRI))).toBe("2026-10-19");
    expect(iso(nextDeliveryDate(new Date("2026-10-18T08:00:00Z"), MON_FRI))).toBe("2026-10-19");
  });

  it("changes when the delivery weekdays change", () => {
    const now = new Date("2026-10-14T08:00:00Z"); // Wednesday
    const before = nextDeliveryDate(now, MON_FRI);
    const after = nextDeliveryDate(now, { ...MON_FRI, deliveryWeekdays: [2, 5] }); // Tue + Fri
    expect(iso(before)).toBe("2026-10-15");
    expect(iso(after)).toBe("2026-10-16");
    expect(iso(nextDeliveryDate(now, { ...MON_FRI, deliveryWeekdays: [3] }))).toBe("2026-10-21");
  });

  it("uses the factory time zone for 'today'", () => {
    // 23:30 UTC on Wed 14 Oct is already Thu 15 Oct 01:30 in Vienna -> next is Fri 16.
    const now = new Date("2026-10-14T23:30:00Z");
    expect(iso(nextDeliveryDate(now, MON_FRI))).toBe("2026-10-16");
    expect(iso(nextDeliveryDate(now, { ...MON_FRI, timezone: "America/New_York" }))).toBe(
      "2026-10-15",
    );
  });

  it("handles the DST switch and returns UTC midnight", () => {
    // Sat 2026-10-24 -> Mon 2026-10-26 spans the DST end on Sun 25 Oct.
    const result = nextDeliveryDate(new Date("2026-10-24T12:00:00Z"), MON_FRI);
    expect(result.toISOString()).toBe("2026-10-26T00:00:00.000Z");
  });

  it("falls back to tomorrow without usable weekdays", () => {
    const now = new Date("2026-10-14T08:00:00Z");
    expect(iso(nextDeliveryDate(now, { ...MON_FRI, deliveryWeekdays: [] }))).toBe("2026-10-15");
  });

  it("can pick Sunday (7) a full week ahead", () => {
    const sunday = new Date("2026-10-18T08:00:00Z");
    expect(iso(nextDeliveryDate(sunday, { ...MON_FRI, deliveryWeekdays: [7] }))).toBe("2026-10-25");
  });
});

describe("isoWeekday", () => {
  it("maps Monday to 1 and Sunday to 7", () => {
    expect(isoWeekday(new Date("2026-10-19T00:00:00Z"))).toBe(1);
    expect(isoWeekday(new Date("2026-10-18T00:00:00Z"))).toBe(7);
  });
});

describe("depot guard", () => {
  const base = {
    depotName: "Fabrik",
    depotAddress: "Graben 1, Wien",
    depotLat: 48.2,
    depotLng: 16.3,
    depotPinConfirmed: true,
  };

  it("returns the depot when the pin is confirmed", () => {
    expect(requireDepot(base)).toEqual({
      name: "Fabrik",
      address: "Graben 1, Wien",
      lat: 48.2,
      lng: 16.3,
    });
    expect(getDepot(base)).not.toBeNull();
  });

  it("refuses without settings or with an unconfirmed pin", () => {
    expect(() => requireDepot(null)).toThrow(DepotNotSetError);
    expect(() => requireDepot({ ...base, depotPinConfirmed: false })).toThrow(DepotNotSetError);
    expect(() => requireDepot({ ...base, depotLat: Number.NaN })).toThrow(/depot pin is not set/);
    expect(getDepot(undefined)).toBeNull();
  });

  it("exposes a stable error code", () => {
    try {
      requireDepot(null);
    } catch (error) {
      expect(error).toMatchObject({ code: "DEPOT_NOT_SET" });
    }
  });
});
