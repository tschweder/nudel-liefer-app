import { describe, expect, it } from "vitest";

import { isNavActive } from "./nav-items";

describe("isNavActive", () => {
  it("matches the dashboard only exactly", () => {
    expect(isNavActive("/admin", "/admin")).toBe(true);
    expect(isNavActive("/admin", "/admin/orders")).toBe(false);
  });

  it("matches a section and its sub-pages but not look-alikes", () => {
    expect(isNavActive("/admin/orders", "/admin/orders")).toBe(true);
    expect(isNavActive("/admin/orders", "/admin/orders/123")).toBe(true);
    expect(isNavActive("/admin/orders", "/admin/orders-archive")).toBe(false);
    expect(isNavActive("/admin/orders", "/admin/tours")).toBe(false);
  });
});
