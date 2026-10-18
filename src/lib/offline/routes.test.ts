import { describe, expect, it } from "vitest";

import { parseOfflineView } from "./routes";

describe("offline shell routes", () => {
  it("shows a stop for /driver/stops/<id> in every locale", () => {
    expect(parseOfflineView("/de/driver/stops/abc")).toEqual({ view: "stop", stopId: "abc" });
    expect(parseOfflineView("/zh-Hant-TW/driver/stops/x%20y/")).toEqual({
      view: "stop",
      stopId: "x y",
    });
  });

  it("shows the list for everything else", () => {
    for (const p of [
      "/de/driver",
      "/de/driver/offline-shell",
      "/de/driver/stops",
      "/x",
      "/de/driver/stops/%E0%A4%A",
    ]) {
      expect(parseOfflineView(p)).toEqual({ view: "list" });
    }
  });
});
