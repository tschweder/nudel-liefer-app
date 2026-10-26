import { describe, expect, it } from "vitest";

import { customerListQuery, parseCustomerListParams } from "./customer-list-params";

describe("customer list URL params", () => {
  it("falls back to defaults for missing / invalid values", () => {
    expect(parseCustomerListParams({ status: "x", page: "-3", photos: "no" })).toMatchObject({
      q: "",
      status: "active",
      page: 1,
      photosMissing: false,
      parkingMissing: false,
    });
  });
  it("parses filters and round-trips", () => {
    const parsed = parseCustomerListParams({
      q: "müller",
      status: "all",
      photos: "missing",
      parking: "missing",
      page: "3",
    });
    expect(parsed).toMatchObject({ q: "müller", status: "all", photosMissing: true, page: 3 });
    expect(customerListQuery(parsed)).toEqual({
      q: "müller",
      status: "all",
      photos: "missing",
      parking: "missing",
      page: "3",
    });
  });
  it("omits defaults", () => {
    expect(
      customerListQuery({
        q: " ",
        status: "active",
        photosMissing: false,
        parkingMissing: false,
        page: 1,
      }),
    ).toEqual({});
  });
});
