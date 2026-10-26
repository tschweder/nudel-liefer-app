import { describe, expect, it } from "vitest";

import {
  dayInTimezone,
  DRIVER_TOUR_SCHEMA_VERSION,
  type DriverTourResponse,
  driverTourResponseSchema,
  toDriverStopDetail,
  toDriverToday,
  tourPhotos,
} from "./driver-tour-model";

const text = (de: string, hans: string) => ({
  de,
  "zh-Hans": hans,
  meta: { source: "de" as const, machine: {}, updatedAt: "2099-01-01T00:00:00Z" },
});

const photo = (id: string) => ({ id, url: `https://s3.test/${id}?sig=1`, width: 800, height: 600 });

function stop(n: number, extra: Record<string, unknown> = {}) {
  return {
    id: `s${n}`,
    sequence: n,
    status: "PENDING" as const,
    problemReason: null,
    completedAt: null,
    etaAt: "2099-07-02T06:00:00.000Z",
    legDurationS: 600,
    change: null,
    changedInRevision: null,
    customerId: `c${n}`,
    customerNumber: `K${n}`,
    customerName: `Trattoria ${n}`,
    street: "Hauptstraße 1",
    postalCode: "1010",
    city: "Wien",
    lat: 48.2,
    lng: 16.3,
    notes: text("Hintereingang", "后门"),
    deliveryHoursInfo: " Mo-Fr 8-11 ",
    photos: { STORE: photo(`store${n}`), PARKING: n === 2 ? null : photo(`park${n}`) },
    items: [
      {
        productId: "p1",
        sku: "SPAG",
        name: text("Spaghetti", "意大利面"),
        unit: "KG",
        quantity: 15,
        previousQuantity: 10,
      },
      {
        productId: "p2",
        sku: "PENN",
        name: null,
        unit: "PACK",
        quantity: 3,
        previousQuantity: null,
      },
    ],
    ...extra,
  };
}

const response = (): DriverTourResponse =>
  driverTourResponseSchema.parse({
    schemaVersion: DRIVER_TOUR_SCHEMA_VERSION,
    date: "2099-07-02",
    generatedAt: "2099-07-02T05:00:00.000Z",
    timezone: "Europe/Vienna",
    serviceSecondsPerStop: 600,
    tour: {
      id: "t1",
      status: "IN_PROGRESS",
      revision: 3,
      updated: true,
      removedCustomers: [{ customerId: "c9", customerNumber: "K9", name: "Gone" }],
      stops: [stop(2, { change: "CHANGED", changedInRevision: 3 }), stop(1), stop(3)],
      depot: { name: "Fabrik", lat: 48.1, lng: 16.4 },
      geometry: [
        [16.3, 48.2],
        [16.4, 48.1],
      ],
    },
  });

describe("driver tour model", () => {
  it("round-trips through JSON unchanged (the shape stored offline)", () => {
    const r = response();
    expect(driverTourResponseSchema.parse(JSON.parse(JSON.stringify(r)))).toEqual(r);
  });

  it("rejects a wrong schema version or a damaged payload", () => {
    expect(driverTourResponseSchema.safeParse({ ...response(), schemaVersion: 2 }).success).toBe(
      false,
    );
    expect(driverTourResponseSchema.safeParse({ ...response(), date: "02.07.2099" }).success).toBe(
      false,
    );
    expect(driverTourResponseSchema.safeParse({ schemaVersion: 1 }).success).toBe(false);
  });

  it("picks the texts in the viewer's locale and keeps the German name for the box labels", () => {
    const de = toDriverToday(response(), "de")!;
    const hans = toDriverToday(response(), "zh-Hans")!;
    const hk = toDriverToday(response(), "zh-Hant-HK")!;
    expect(de.stops[0]!.items[0]).toMatchObject({ name: "Spaghetti", germanName: "Spaghetti" });
    expect(hans.stops[0]!.items[0]).toMatchObject({ name: "意大利面", germanName: "Spaghetti" });
    // no HK text: closest Chinese variant (Hans) per the read rule
    expect(hk.stops[0]!.items[0]!.name).toBe("意大利面");
    // a product without a name shows its SKU
    expect(de.stops[0]!.items[1]).toMatchObject({ name: "PENN", germanName: null });
  });

  it("keeps the tour update data of NUD-043 (revision, banner, change markers, old quantities)", () => {
    const today = toDriverToday(response(), "de")!;
    expect(today).toMatchObject({
      tourId: "t1",
      revision: 3,
      updated: true,
      removedCustomers: [{ name: "Gone" }],
    });
    const changed = today.stops.find((s) => s.id === "s2")!;
    expect(changed).toMatchObject({ change: "CHANGED", changedInRevision: 3 });
    expect(changed.items[0]).toMatchObject({ quantity: 15, previousQuantity: 10 });
  });

  it("never translates customer names and addresses", () => {
    const today = toDriverToday(response(), "zh-Hans")!;
    expect(today.stops[0]).toMatchObject({
      customerName: "Trattoria 2",
      street: "Hauptstraße 1",
      city: "Wien",
    });
  });

  it("has no tour view without a tour", () => {
    expect(toDriverToday({ ...response(), tour: null }, "de")).toBeNull();
    expect(toDriverStopDetail({ ...response(), tour: null }, "s1", "de")).toBeNull();
  });

  it("derives the stop detail with neighbours in tour order, notes and photos", () => {
    const d = toDriverStopDetail(response(), "s2", "zh-Hans")!;
    expect(d).toMatchObject({
      position: 2,
      total: 3,
      prevStopId: "s1",
      nextStopId: "s3",
      notes: { text: "后门", lang: "zh-Hans" },
      deliveryHoursInfo: "Mo-Fr 8-11",
    });
    expect(d.photos.STORE).toMatchObject({ id: "store2", url: "https://s3.test/store2?sig=1" });
    expect(d.photos.PARKING).toBeNull();
    expect(toDriverStopDetail(response(), "unknown", "de")).toBeNull();
  });

  it("maps photo URLs for offline display", () => {
    const d = toDriverStopDetail(response(), "s1", "de", (p) => `/cache/${p.id}`)!;
    expect(d.photos.STORE!.url).toBe("/cache/store1");
  });

  it("lists every photo once", () => {
    const ids = tourPhotos(response()).map((p) => p.id);
    expect(ids.sort()).toEqual(["park1", "park3", "store1", "store2", "store3"]);
    expect(tourPhotos({ ...response(), tour: null })).toEqual([]);
  });

  it("computes the day in the factory time zone", () => {
    expect(dayInTimezone(new Date("2099-07-01T22:30:00Z"), "Europe/Vienna")).toBe("2099-07-02");
    expect(dayInTimezone(new Date("2099-07-01T22:30:00Z"), "UTC")).toBe("2099-07-01");
  });
});
