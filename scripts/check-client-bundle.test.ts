import { describe, expect, it } from "vitest";

import { findSignatures } from "./check-client-bundle";

describe("check-client-bundle", () => {
  it("flags OpenCC dictionary entries", () => {
    expect(findSignatures("…|意大利面 意大利麪|意大利直面 意大利直麪|…")).toContain(
      "意大利面 意大利麪",
    );
    expect(findSignatures("…|意大利 義大利|…")).toEqual(["意大利 義大利"]);
  });
  it("ignores ordinary UI text", () => {
    expect(findSignatures('{"title":"意大利面","de":"Nudeln"}')).toEqual([]);
  });
});
