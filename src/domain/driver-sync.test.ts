import { describe, expect, it } from "vitest";

import { effectiveMutationTime, parseSyncResponse, SYNC_MAX_AGE_MS } from "./driver-sync";

const now = new Date("2099-07-02T10:00:00.000Z");

describe("effectiveMutationTime", () => {
  it("uses the time of the tap when it is plausible", () => {
    const at = new Date("2099-07-02T08:30:00.000Z");
    expect(effectiveMutationTime(at, now)).toEqual(at);
  });

  it("never lets a tap lie in the future (phone clock ahead)", () => {
    expect(effectiveMutationTime(new Date("2099-07-02T10:05:00.000Z"), now)).toEqual(now);
  });

  it("never trusts a tap older than 24 hours (phone clock far behind)", () => {
    expect(effectiveMutationTime(new Date("2099-06-01T00:00:00.000Z"), now)).toEqual(
      new Date(now.getTime() - SYNC_MAX_AGE_MS),
    );
  });

  it("falls back to now for an invalid date", () => {
    expect(effectiveMutationTime(new Date("nope"), now)).toEqual(now);
  });
});

describe("parseSyncResponse", () => {
  const good = {
    results: [
      { clientMutationId: "a", outcome: "applied" },
      { clientMutationId: "b", outcome: "rejected", error: "changed_by_office" },
    ],
    tours: [
      {
        tourId: "t1",
        status: "IN_PROGRESS",
        stops: [
          {
            id: "s1",
            status: "DELIVERED",
            problemReason: null,
            completedAt: "2099-07-02T08:00:00Z",
          },
        ],
      },
    ],
    serverTime: "2099-07-02T10:00:00.000Z",
  };

  it("accepts a well-formed answer", () => {
    expect(parseSyncResponse(good)).toEqual(good);
  });

  it("carries the departure checklist times of a tour when the server sends them (NUD-151)", () => {
    const withTimes = {
      ...good,
      tours: [
        {
          ...good.tours[0]!,
          loadingStartedAt: "2099-07-02T05:40:00.000Z",
          departedAt: null,
        },
      ],
    };
    expect(parseSyncResponse(withTimes)).toEqual(withTimes);
    expect(
      parseSyncResponse({ ...good, tours: [{ ...good.tours[0]!, departedAt: 5 }] }),
    ).toBeNull();
    // Answers of older servers have no such fields.
    expect(parseSyncResponse(good)?.tours[0]).not.toHaveProperty("departedAt");
  });

  it("carries the customer's key per stop when the server sends it (NUD-142)", () => {
    const withKey = {
      ...good,
      tours: [
        {
          ...good.tours[0]!,
          stops: [{ ...good.tours[0]!.stops[0]!, hasKey: true, keyNumber: "17" }],
        },
      ],
    };
    expect(parseSyncResponse(withKey)).toEqual(withKey);
    const unknown = {
      ...good,
      tours: [
        {
          ...good.tours[0]!,
          stops: [{ ...good.tours[0]!.stops[0]!, hasKey: null, keyNumber: null }],
        },
      ],
    };
    expect(parseSyncResponse(unknown)).toEqual(unknown);
  });

  it("rejects a key that is not a boolean / string", () => {
    const bad = (extra: object) => ({
      ...good,
      tours: [{ ...good.tours[0]!, stops: [{ ...good.tours[0]!.stops[0]!, ...extra }] }],
    });
    expect(parseSyncResponse(bad({ hasKey: "yes" }))).toBeNull();
    expect(parseSyncResponse(bad({ keyNumber: 17 }))).toBeNull();
  });

  it("carries the customer's Abkürzung per stop when the server sends it (NUD-164)", () => {
    const stopWith = (extra: object) => ({
      ...good,
      tours: [{ ...good.tours[0]!, stops: [{ ...good.tours[0]!.stops[0]!, ...extra }] }],
    });
    const withText = stopWith({ abbreviation: "Ä/ß-#1" });
    expect(parseSyncResponse(withText)).toEqual(withText);
    const none = stopWith({ abbreviation: null });
    expect(parseSyncResponse(none)).toEqual(none);
    expect(parseSyncResponse(stopWith({ abbreviation: 17 }))).toBeNull();
  });

  it.each([
    ["not an object", "x"],
    ["no results", { tours: [] }],
    ["unknown outcome", { ...good, results: [{ clientMutationId: "a", outcome: "maybe" }] }],
    [
      "bad stop status",
      {
        ...good,
        tours: [
          {
            tourId: "t",
            status: "x",
            stops: [{ id: "s", status: "DONE", problemReason: null, completedAt: null }],
          },
        ],
      },
    ],
    [
      "error not a string",
      { ...good, results: [{ clientMutationId: "a", outcome: "rejected", error: 4 }] },
    ],
  ])("rejects %s", (_name, raw) => {
    expect(parseSyncResponse(raw)).toBeNull();
  });
});
