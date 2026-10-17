import { describe, expect, it } from "vitest";

import { sum } from "./example";

describe("sum", () => {
  it("adds numbers", () => {
    expect(sum(2, 3)).toBe(5);
  });
});
