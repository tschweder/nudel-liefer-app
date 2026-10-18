import { describe, expect, it } from "vitest";

import {
  type ConfirmedPhoto,
  newestQueued,
  patchTourPhoto,
  type PhotoEntry,
  shownPhoto,
  sortPhotoEntries,
  supersededBy,
} from "./photo-outbox";

const entry = (id: string, extra: Partial<PhotoEntry> = {}): PhotoEntry => ({
  clientMutationId: id,
  userId: "u1",
  stopId: "s1",
  customerId: "c1",
  customerName: "Trattoria",
  kind: "STORE",
  blob: new Blob(["x"], { type: "image/jpeg" }),
  width: 1600,
  height: 1200,
  createdAt: "2099-07-02T08:00:00.000Z",
  seq: 1,
  ...extra,
});

describe("queue rules", () => {
  it("orders by time, then sequence", () => {
    const a = entry("a", { createdAt: "2099-07-02T08:00:02.000Z", seq: 1 });
    const b = entry("b", { createdAt: "2099-07-02T08:00:01.000Z", seq: 2 });
    const c = entry("c", { createdAt: "2099-07-02T08:00:01.000Z", seq: 3 });
    expect(sortPhotoEntries([a, c, b]).map((e) => e.clientMutationId)).toEqual(["b", "c", "a"]);
  });

  it("a new photo supersedes unsent photos of the same customer and kind only", () => {
    const queued = [
      entry("same"),
      entry("uploaded", { storageKey: "customers/x.jpg" }),
      entry("flying"),
      entry("other-kind", { kind: "PARKING" }),
      entry("other-customer", { customerId: "c2" }),
      entry("other-user", { userId: "u2" }),
    ];
    expect(
      supersededBy(queued, { customerId: "c1", kind: "STORE", userId: "u1" }, new Set(["flying"])),
    ).toEqual(["same"]);
  });

  it("the newest queued photo of a slot counts", () => {
    const entries = [
      entry("old", { seq: 1 }),
      entry("new", { seq: 2, createdAt: "2099-07-02T08:05:00.000Z" }),
      entry("p", { kind: "PARKING", seq: 3 }),
    ];
    expect(newestQueued(entries, "c1", "STORE")?.clientMutationId).toBe("new");
    expect(newestQueued(entries, "c1", "PARKING")?.clientMutationId).toBe("p");
    expect(newestQueued(entries, "c9", "STORE")).toBeNull();
  });
});

describe("what a slot shows", () => {
  const base = { id: "p0", url: "https://s3.test/base", width: 800, height: 600 };
  const confirmed: ConfirmedPhoto = {
    id: "p1",
    url: "https://s3.test/new",
    width: 1600,
    height: 1200,
    customerId: "c1",
    kind: "STORE",
  };
  const urlFor = () => "blob:local";

  it("shows the photo the page was rendered with when nothing is queued", () => {
    expect(shownPhoto(base, null, undefined, urlFor)).toMatchObject({
      id: "p0",
      pending: false,
      sent: false,
    });
    expect(shownPhoto(null, null, undefined, urlFor)).toBeNull();
  });

  it("a queued photo is shown from its local blob and marked pending, over everything else", () => {
    expect(shownPhoto(base, entry("q"), confirmed, urlFor)).toMatchObject({
      url: "blob:local",
      pending: true,
      sent: false,
    });
  });

  it("falls back to the confirmed photo while the blob URL is not ready", () => {
    expect(shownPhoto(base, entry("q"), confirmed, () => undefined)).toMatchObject({
      id: "p1",
      sent: true,
    });
  });

  it("a just confirmed photo wins over the not yet refreshed page data", () => {
    expect(shownPhoto(base, null, confirmed, urlFor)).toMatchObject({ id: "p1", sent: true });
    expect(shownPhoto(null, null, confirmed, urlFor)).toMatchObject({ id: "p1", sent: true });
  });
});

describe("patchTourPhoto", () => {
  const photo = { id: "p9", url: "https://s3.test/9", width: 10, height: 10 };
  type Slot = { id: string; url: string; width: number; height: number } | null;
  type Data = {
    tour: null | {
      id: string;
      stops: Array<{ id: string; customerId: string; photos: { STORE: Slot; PARKING: Slot } }>;
    };
  };
  const data: Data = {
    tour: {
      id: "t1",
      stops: [
        { id: "s1", customerId: "c1", photos: { STORE: null, PARKING: { ...photo, id: "pk" } } },
        { id: "s2", customerId: "c2", photos: { STORE: null, PARKING: null } },
        { id: "s3", customerId: "c1", photos: { STORE: null, PARKING: null } },
      ],
    },
  };

  it("sets the photo on every stop of the customer, only for that kind", () => {
    const next = patchTourPhoto(data, "c1", "STORE", photo);
    expect(next.tour!.stops.map((s) => s.photos.STORE?.id ?? null)).toEqual(["p9", null, "p9"]);
    expect(next.tour!.stops[0]!.photos.PARKING?.id).toBe("pk");
    expect(data.tour!.stops[0]!.photos.STORE).toBeNull(); // input untouched
  });

  it("returns the same object when the customer has no stop or there is no tour", () => {
    expect(patchTourPhoto(data, "c9", "STORE", photo)).toBe(data);
    const none: Data = { tour: null };
    expect(patchTourPhoto(none, "c1", "STORE", photo)).toBe(none);
  });
});
