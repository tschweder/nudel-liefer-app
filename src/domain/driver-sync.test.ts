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
