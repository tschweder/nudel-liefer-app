import { createFormatter } from "next-intl";
import { describe, expect, it } from "vitest";

import { createAppFormatters } from "./format";

const f = (locale: string) => createAppFormatters(createFormatter({ locale }));

describe("createAppFormatters", () => {
  it("shows quantities as whole numbers, per locale", () => {
    expect(f("de").quantity(5)).toBe("5");
    expect(f("de").quantity("5")).toBe("5");
    expect(f("de").quantity(1200)).toBe("1.200");
    expect(f("zh-Hans").quantity(1200)).toBe("1,200");
  });

  it("formats calendar dates without shifting the day", () => {
    const deliveryDate = new Date("2026-10-17T00:00:00.000Z");
    expect(f("de").calendarDate(deliveryDate)).toBe("17.10.2026");
    expect(f("sr-Latn").calendarDate(deliveryDate)).toMatch(/2026/);
  });

  it("formats moments in the factory time zone", () => {
    const moment = new Date("2026-10-17T22:30:00.000Z"); // 00:30 next day in Vienna (CEST)
    expect(f("de").time(moment)).toBe("00:30");
    expect(f("de").dateShort(moment)).toContain("18");
  });
});
