import { describe, expect, it } from "vitest";

import { photosMissing } from "./photos";

describe("photosMissing", () => {
  it("is false only when both a STORE and a PARKING photo are current", () => {
    expect(photosMissing([])).toBe(true);
    expect(photosMissing(["STORE"])).toBe(true);
    expect(photosMissing(["PARKING"])).toBe(true);
    expect(photosMissing(["STORE", "STORE"])).toBe(true);
    expect(photosMissing(["STORE", "PARKING"])).toBe(false);
    expect(photosMissing(["PARKING", "STORE", "STORE"])).toBe(false);
  });
});
