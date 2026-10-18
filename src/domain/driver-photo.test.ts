import { describe, expect, it } from "vitest";

import { isPhotoTourDayAllowed, parsePhotoRegisterResponse, previousDay } from "./driver-photo";

describe("photo tour day rule", () => {
  it("computes the previous calendar day across month and year ends", () => {
    expect(previousDay("2099-07-02")).toBe("2099-07-01");
    expect(previousDay("2099-03-01")).toBe("2099-02-28");
    expect(previousDay("2100-01-01")).toBe("2099-12-31");
  });

  it("allows today and yesterday (offline queue after midnight), nothing else", () => {
    expect(isPhotoTourDayAllowed("2099-07-02", "2099-07-02")).toBe(true);
    expect(isPhotoTourDayAllowed("2099-07-01", "2099-07-02")).toBe(true);
    expect(isPhotoTourDayAllowed("2099-06-30", "2099-07-02")).toBe(false);
    expect(isPhotoTourDayAllowed("2099-07-03", "2099-07-02")).toBe(false);
  });
});

describe("parsePhotoRegisterResponse", () => {
  const photo = { id: "p1", url: "https://s3.test/x", width: 1600, height: 1200 };
  it("accepts applied / replayed / rejected answers", () => {
    expect(
      parsePhotoRegisterResponse({ outcome: "applied", kind: "STORE", customerId: "c1", photo }),
    ).toEqual({ outcome: "applied", kind: "STORE", customerId: "c1", photo });
    expect(
      parsePhotoRegisterResponse({
        outcome: "replayed",
        kind: "PARKING",
        customerId: "c1",
        photo,
      })?.outcome,
    ).toBe("replayed");
    expect(parsePhotoRegisterResponse({ outcome: "rejected", error: "not_found" })).toEqual({
      outcome: "rejected",
      error: "not_found",
    });
  });

  it("rejects anything else", () => {
    for (const raw of [
      null,
      "x",
      {},
      { outcome: "applied" },
      { outcome: "applied", kind: "OTHER", customerId: "c1", photo },
      { outcome: "applied", kind: "STORE", customerId: "c1", photo: { id: "p" } },
      { outcome: "rejected", error: "boom" },
      { outcome: "maybe" },
    ]) {
      expect(parsePhotoRegisterResponse(raw)).toBeNull();
    }
  });
});
