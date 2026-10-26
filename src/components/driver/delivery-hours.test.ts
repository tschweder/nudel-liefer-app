import { describe, expect, it } from "vitest";

import { localizeDeliveryHours } from "./delivery-hours";

/** Stand-ins for the message keys of `driver.stop.weekday*` / `driver.stop.clockSuffix`. */
const ZH = {
  weekdayMo: "周一",
  weekdayTu: "周二",
  weekdayWe: "周三",
  weekdayTh: "周四",
  weekdayFr: "周五",
  weekdaySa: "周六",
  weekdaySu: "周日",
} as const;

const zh = (key: keyof typeof ZH) => ZH[key];
const de = (key: string) => key.replace("weekday", "");

describe("localizeDeliveryHours", () => {
  it("replaces weekday abbreviations and the Uhr suffix", () => {
    expect(localizeDeliveryHours("Mo–Fr 8–11 Uhr", zh, "时")).toBe("周一–周五 8–11 时");
    expect(localizeDeliveryHours("Mo-Sa 7-11 Uhr", zh, "时")).toBe("周一-周六 7-11 时");
    expect(localizeDeliveryHours("Di 9–12 Uhr", zh, "时")).toBe("周二 9–12 时");
    expect(localizeDeliveryHours("Mo.-Fr. 8-11 Uhr", zh, "时")).toBe("周一.-周五. 8-11 时");
  });

  it("returns German text unchanged", () => {
    for (const value of ["Mo–Fr 8–11 Uhr", "Mo-Fr 6-10", "Mo.-Fr. 8-11 Uhr"]) {
      expect(localizeDeliveryHours(value, de, "Uhr")).toBe(value);
    }
  });

  it("leaves text without weekdays or Uhr alone", () => {
    expect(localizeDeliveryHours("nach Vereinbarung", zh, "时")).toBe("nach Vereinbarung");
    expect(localizeDeliveryHours("6", zh, "时")).toBe("6");
  });

  it("does not touch weekday tokens inside longer words", () => {
    expect(localizeDeliveryHours("Montag 8-11 Uhr", zh, "时")).toBe("Montag 8-11 时");
    expect(localizeDeliveryHours("täglich 8–11 Uhr", zh, "时")).toBe("täglich 8–11 时");
  });
});
