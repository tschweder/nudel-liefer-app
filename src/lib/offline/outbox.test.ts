import { describe, expect, it } from "vitest";

import {
  afterFailure,
  BACKOFF_MAX_MS,
  backoffDelayMs,
  chunk,
  isStopStatusEntry,
  mayAttempt,
  nextSeq,
  NO_BACKOFF,
  type OutboxEntry,
  overlayDeparture,
  overlayStop,
  overlayStops,
  patchTourStates,
  planUndo,
  settle,
  sortEntries,
  toSyncEntry,
} from "./outbox";

let seq = 0;
function entry(extra: Partial<OutboxEntry> & Pick<OutboxEntry, "type" | "stopId">): OutboxEntry {
  seq += 1;
  return {
    clientMutationId: `m${seq}`,
    userId: "u1",
    createdAt: `2099-07-02T08:00:${String(seq).padStart(2, "0")}.000Z`,
    seq,
    customerName: "Trattoria Roma",
    ...extra,
  };
}

const pending = {
  id: "s1",
  status: "PENDING" as const,
  problemReason: null,
  completedAt: null,
};

describe("ordering and batching", () => {
  it("orders by tap time, then by sequence", () => {
    const a = entry({
      type: "delivered",
      stopId: "s1",
      createdAt: "2099-07-02T08:00:05.000Z",
      seq: 2,
    });
    const b = entry({
      type: "delivered",
      stopId: "s2",
      createdAt: "2099-07-02T08:00:05.000Z",
      seq: 1,
    });
    const c = entry({
      type: "delivered",
      stopId: "s3",
      createdAt: "2099-07-02T08:00:01.000Z",
      seq: 3,
    });
    expect(sortEntries([a, b, c]).map((e) => e.stopId)).toEqual(["s3", "s2", "s1"]);
    expect(nextSeq([a, b, c])).toBe(4);
    expect(nextSeq([])).toBe(1);
  });

  it("splits a long queue into requests of at most N entries, keeping the order", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });

  it("sends only what the server needs", () => {
    const e = entry({ type: "problem", stopId: "s1", reason: "CLOSED", note: "Tor zu" });
    expect(toSyncEntry(e)).toEqual({
      clientMutationId: e.clientMutationId,
      type: "problem",
      stopId: "s1",
      reason: "CLOSED",
      note: "Tor zu",
      createdAt: e.createdAt,
    });
    const d = entry({ type: "delivered", stopId: "s1", reason: "CLOSED" });
    expect(toSyncEntry(d)).not.toHaveProperty("reason");
  });
});

describe("planUndo", () => {
  it("cancels a queued completion instead of sending delivered + undo", () => {
    const e = entry({ type: "delivered", stopId: "s1" });
    expect(planUndo([e], "s1", new Set())).toEqual({
      action: "cancel",
      clientMutationId: e.clientMutationId,
    });
  });

  it("queues a real undo when the completion is on its way or already confirmed", () => {
    const e = entry({ type: "delivered", stopId: "s1" });
    expect(planUndo([e], "s1", new Set([e.clientMutationId]))).toEqual({ action: "enqueue" });
    expect(planUndo([], "s1", new Set())).toEqual({ action: "enqueue" });
    expect(planUndo([entry({ type: "delivered", stopId: "other" })], "s1", new Set())).toEqual({
      action: "enqueue",
    });
  });

  it("ignores a second undo tap", () => {
    const done = entry({ type: "delivered", stopId: "s1" });
    const undo = entry({ type: "undo", stopId: "s1" });
    expect(planUndo([done, undo], "s1", new Set([done.clientMutationId]))).toEqual({
      action: "none",
    });
  });
});

describe("overlay", () => {
  it("shows a queued delivery as delivered, with the time of the tap", () => {
    const e = entry({ type: "delivered", stopId: "s1" });
    expect(overlayStop(pending, [e])).toEqual({
      ...pending,
      status: "DELIVERED",
      completedAt: e.createdAt,
    });
  });

  it("shows a queued problem with its reason", () => {
    const e = entry({ type: "problem", stopId: "s1", reason: "NO_PARKING" });
    expect(overlayStop(pending, [e])).toMatchObject({
      status: "PROBLEM",
      problemReason: "NO_PARKING",
    });
  });

  it("applies a queued undo behind a confirmed completion", () => {
    const done = { ...pending, status: "DELIVERED" as const, completedAt: "2099-07-02T07:00:00Z" };
    const undo = entry({ type: "undo", stopId: "s1" });
    expect(overlayStop(done, [undo])).toEqual(pending);
  });

  it("applies delivered then undo in tap order", () => {
    const d = entry({ type: "delivered", stopId: "s1" });
    const u = entry({ type: "undo", stopId: "s1" });
    expect(overlayStop(pending, [u, d])).toEqual(pending);
  });

  it("ignores a second completion of a closed stop (the server would refuse it)", () => {
    const d = entry({ type: "delivered", stopId: "s1" });
    const p = entry({ type: "problem", stopId: "s1", reason: "CLOSED" });
    expect(overlayStop(pending, [d, p]).status).toBe("DELIVERED");
  });

  it("leaves other stops and an empty queue untouched (same references)", () => {
    const stops = [pending, { ...pending, id: "s2" }];
    expect(overlayStops(stops, [])).toBe(stops);
    const out = overlayStops(stops, [entry({ type: "delivered", stopId: "s2" })]);
    expect(out[0]).toBe(stops[0]);
    expect(out[1]!.status).toBe("DELIVERED");
  });
});

describe("settle", () => {
  const a = entry({ type: "delivered", stopId: "s1" });
  const b = entry({ type: "delivered", stopId: "s2", customerName: "Pizzeria Napoli" });
  const c = entry({ type: "delivered", stopId: "s3" });
  const now = new Date("2099-07-02T10:00:00.000Z");

  it("removes applied and replayed entries, turns rejections into notices, keeps retries", () => {
    const out = settle(
      [a, b, c],
      [
        { clientMutationId: a.clientMutationId, outcome: "replayed" },
        { clientMutationId: b.clientMutationId, outcome: "rejected", error: "changed_by_office" },
        { clientMutationId: c.clientMutationId, outcome: "retry" },
      ],
      now,
    );
    expect(out.done).toEqual([a.clientMutationId, b.clientMutationId]);
    expect(out.retry).toEqual([c.clientMutationId]);
    expect(out.notices).toEqual([
      {
        id: b.clientMutationId,
        userId: "u1",
        stopId: "s2",
        customerName: "Pizzeria Napoli",
        type: "delivered",
        error: "changed_by_office",
        createdAt: now.toISOString(),
      },
    ]);
  });

  it("keeps an entry the answer does not mention", () => {
    expect(settle([a], [], now).retry).toEqual([a.clientMutationId]);
  });
});

describe("patchTourStates", () => {
  const data = {
    tour: {
      id: "t1",
      status: "RELEASED",
      stops: [
        { id: "s1", status: "PENDING" as const, problemReason: null, completedAt: null },
        { id: "s2", status: "PENDING" as const, problemReason: null, completedAt: null },
      ],
    },
  };

  it("writes the authoritative states into the stored tour", () => {
    const out = patchTourStates(data, [
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
    ]);
    expect(out.tour!.status).toBe("IN_PROGRESS");
    expect(out.tour!.stops[0]).toMatchObject({
      status: "DELIVERED",
      completedAt: "2099-07-02T08:00:00Z",
    });
    expect(out.tour!.stops[1]).toBe(data.tour.stops[1]);
  });

  it("leaves the data alone for another tour or no tour", () => {
    expect(patchTourStates(data, [{ tourId: "other", status: "X", stops: [] }])).toBe(data);
    const none = { tour: null };
    expect(patchTourStates(none, [])).toBe(none);
  });
});

describe("backoff", () => {
  it("doubles from 2 s up to 5 minutes", () => {
    expect([1, 2, 3, 4, 5].map(backoffDelayMs)).toEqual([2000, 4000, 8000, 16000, 32000]);
    expect(backoffDelayMs(0)).toBe(0);
    expect(backoffDelayMs(50)).toBe(BACKOFF_MAX_MS);
  });

  it("makes regular triggers wait but lets a changed situation through", () => {
    let state = afterFailure(NO_BACKOFF, 1000);
    expect(state).toEqual({ failures: 1, retryAt: 3000 });
    expect(mayAttempt(state, 2000, false)).toBe(false);
    expect(mayAttempt(state, 2000, true)).toBe(true);
    expect(mayAttempt(state, 3000, false)).toBe(true);
    state = afterFailure(state, 3000);
    expect(state).toEqual({ failures: 2, retryAt: 7000 });
    expect(mayAttempt(NO_BACKOFF, 0, false)).toBe(true);
  });
});

describe("customer Abkürzung entries (NUD-164)", () => {
  const abbr = (stopId: string, abbreviation?: string) =>
    entry({ type: "abbreviation", stopId, ...(abbreviation ? { abbreviation } : {}) });

  it("sends the text only for abbreviation entries; clearing sends none", () => {
    expect(toSyncEntry(abbr("s1", "Ä/ß-#1"))).toEqual({
      clientMutationId: expect.any(String),
      type: "abbreviation",
      stopId: "s1",
      abbreviation: "Ä/ß-#1",
      createdAt: expect.any(String),
    });
    expect(toSyncEntry(abbr("s1"))).not.toHaveProperty("abbreviation");
    expect(
      toSyncEntry(entry({ type: "delivered", stopId: "s1", abbreviation: "X" })),
    ).not.toHaveProperty("abbreviation");
  });

  it("overlays the newest text at once, independent of the stop status; clearing shows none", () => {
    const stop = { ...pending, abbreviation: null as string | null };
    expect(overlayStop(stop, [abbr("s1", "A1")])).toMatchObject({
      status: "PENDING",
      abbreviation: "A1",
    });
    expect(overlayStop(stop, [abbr("s1", "A1"), abbr("s1", "B2")])).toMatchObject({
      abbreviation: "B2",
    });
    expect(overlayStop(stop, [abbr("s1", "A1"), abbr("s1")])).toMatchObject({
      abbreviation: null,
    });
  });

  it("does not let an undo cancel a queued Abkürzung entry", () => {
    expect(planUndo([abbr("s1", "A1")], "s1", new Set())).toEqual({ action: "enqueue" });
  });
});

describe("customer key entries (NUD-142)", () => {
  const key = (stopId: string, hasKey: boolean, keyNumber?: string) =>
    entry({ type: "key", stopId, hasKey, ...(keyNumber ? { keyNumber } : {}) });

  it("sends the key fields, and only for key entries", () => {
    expect(toSyncEntry(key("s1", true, "17"))).toEqual({
      clientMutationId: expect.any(String),
      type: "key",
      stopId: "s1",
      hasKey: true,
      keyNumber: "17",
      createdAt: expect.any(String),
    });
    expect(toSyncEntry(key("s1", false))).not.toHaveProperty("keyNumber");
    expect(
      toSyncEntry(entry({ type: "delivered", stopId: "s1", hasKey: true })),
    ).not.toHaveProperty("hasKey");
  });

  it("overlays the new key at once, independent of the stop status", () => {
    const stop = { ...pending, hasKey: null as boolean | null, keyNumber: null as string | null };
    const out = overlayStop(stop, [key("s1", true, "17")]);
    expect(out).toMatchObject({ status: "PENDING", hasKey: true, keyNumber: "17" });
    const closed = overlayStop(stop, [
      entry({ type: "delivered", stopId: "s1" }),
      key("s1", true, "17"),
    ]);
    expect(closed).toMatchObject({ status: "DELIVERED", hasKey: true, keyNumber: "17" });
    // the newest key entry wins; "no key" drops the number
    expect(overlayStop(stop, [key("s1", true, "17"), key("s1", false)])).toMatchObject({
      hasKey: false,
      keyNumber: null,
    });
  });

  it("does not let an undo cancel a queued key entry or hide a queued completion", () => {
    const done = entry({ type: "delivered", stopId: "s1" });
    const k = key("s1", true, "17");
    expect(planUndo([done, k], "s1", new Set())).toEqual({
      action: "cancel",
      clientMutationId: done.clientMutationId,
    });
    expect(planUndo([k], "s1", new Set())).toEqual({ action: "enqueue" });
  });

  it("writes the authoritative key into the stored tour", () => {
    const data = {
      tour: {
        id: "t1",
        status: "RELEASED",
        stops: [
          { id: "s1", status: "PENDING" as const, problemReason: null, completedAt: null },
          { id: "s2", status: "PENDING" as const, problemReason: null, completedAt: null },
        ],
      },
    };
    const out = patchTourStates(data, [
      {
        tourId: "t1",
        status: "RELEASED",
        stops: [
          {
            id: "s1",
            status: "PENDING",
            problemReason: null,
            completedAt: null,
            hasKey: true,
            keyNumber: "17",
          },
        ],
      },
    ]);
    expect(out.tour!.stops[0]).toMatchObject({ hasKey: true, keyNumber: "17" });
    expect(out.tour!.stops[1]).not.toHaveProperty("hasKey");
  });
});

describe("Parkplatz entries (NUD-144)", () => {
  const parking = (stopId: string, lat: number, lng: number) =>
    entry({ type: "parking", stopId, lat, lng });

  it("sends the point, and only for parking entries", () => {
    expect(toSyncEntry(parking("s1", 48.2082, 16.3738))).toEqual({
      clientMutationId: expect.any(String),
      type: "parking",
      stopId: "s1",
      lat: 48.2082,
      lng: 16.3738,
      createdAt: expect.any(String),
    });
    expect(
      toSyncEntry(entry({ type: "delivered", stopId: "s1", lat: 1, lng: 2 })),
    ).not.toHaveProperty("lat");
  });

  it("shows the queued point at once: routing point when there was none, else appended", () => {
    const empty = {
      ...pending,
      lat: 48.2 as number | null,
      lng: 16.3 as number | null,
      parkingSpots: [],
    };
    const out = overlayStop(empty, [parking("s1", 48.2082, 16.3738)]);
    expect(out).toMatchObject({
      lat: 48.2082,
      lng: 16.3738,
      parkingSpots: [{ label: null, note: null, lat: 48.2082, lng: 16.3738 }],
    });
    const spot = { label: "Hof", note: null, lat: 48.5, lng: 16.9 };
    const some = { ...empty, lat: 48.5, lng: 16.9, parkingSpots: [spot] };
    const two = overlayStop(some, [parking("s1", 48.6, 17)]);
    expect(two).toMatchObject({ lat: 48.5, lng: 16.9 });
    expect(two.parkingSpots).toHaveLength(2);
    // the same point twice (queued and already confirmed) is shown once
    expect(overlayStop(two, [parking("s1", 48.6, 17)]).parkingSpots).toHaveLength(2);
    // screens without Parkplatz data are left alone
    expect(overlayStop(pending, [parking("s1", 1, 2)])).toEqual(pending);
  });

  it("does not let an undo cancel a queued Parkplatz entry", () => {
    const done = entry({ type: "delivered", stopId: "s1" });
    expect(planUndo([done, parking("s1", 1, 2)], "s1", new Set())).toEqual({
      action: "cancel",
      clientMutationId: done.clientMutationId,
    });
    expect(planUndo([parking("s1", 1, 2)], "s1", new Set())).toEqual({ action: "enqueue" });
  });

  it("writes the server's Parkplätze and routing point into the stored tour", () => {
    const data = {
      tour: {
        id: "t1",
        status: "RELEASED",
        stops: [{ id: "s1", status: "PENDING" as const, problemReason: null, completedAt: null }],
      },
    };
    const out = patchTourStates(data, [
      {
        tourId: "t1",
        status: "RELEASED",
        stops: [
          {
            id: "s1",
            status: "PENDING",
            problemReason: null,
            completedAt: null,
            parkingSpots: [{ label: null, note: null, lat: 48.2082, lng: 16.3738 }],
          },
        ],
      },
    ]);
    expect(out.tour!.stops[0]).toMatchObject({ lat: 48.2082, lng: 16.3738 });
  });
});

describe("departure entries (NUD-151)", () => {
  const ids = new Set(["s1", "s2"]);
  const server = { loadingStartedAt: null, departedAt: null };

  it("sends type and stop, nothing else", () => {
    const loading = entry({ type: "loading", stopId: "s1", hasKey: true, keyNumber: "7" });
    expect(toSyncEntry(loading)).toEqual({
      clientMutationId: loading.clientMutationId,
      type: "loading",
      stopId: "s1",
      createdAt: loading.createdAt,
    });
  });

  it("shows queued taps at once, with the time of the tap; the first tap wins", () => {
    const a = entry({ type: "loading", stopId: "s1" });
    const b = entry({ type: "depart", stopId: "s1" });
    const c = entry({ type: "depart", stopId: "s1" });
    expect(overlayDeparture(server, [a, b, c], ids)).toEqual({
      loadingStartedAt: a.createdAt,
      departedAt: b.createdAt,
    });
    // What the server already holds is not overwritten.
    expect(
      overlayDeparture({ loadingStartedAt: "2099-07-02T05:00:00Z", departedAt: null }, [a], ids),
    ).toEqual({ loadingStartedAt: "2099-07-02T05:00:00Z", departedAt: null });
    // Entries for stops of another tour are ignored.
    expect(overlayDeparture(server, [entry({ type: "depart", stopId: "x" })], ids)).toEqual(server);
  });

  it("is neither a completion nor an undo target", () => {
    const stop = { ...pending, id: "s1" };
    const queued = [entry({ type: "depart", stopId: "s1" })];
    expect(overlayStop(stop, queued)).toEqual(stop);
    expect(planUndo(queued, "s1", new Set())).toEqual({ action: "enqueue" });
    const done = entry({ type: "delivered", stopId: "s1" });
    expect(planUndo([done, ...queued], "s1", new Set())).toEqual({
      action: "cancel",
      clientMutationId: done.clientMutationId,
    });
    expect(isStopStatusEntry("depart")).toBe(false);
    expect(isStopStatusEntry("undo")).toBe(true);
  });

  it("writes the authoritative times into the stored tour", () => {
    const data = { tour: { id: "t1", status: "RELEASED", stops: [] } };
    const patched = patchTourStates(data, [
      {
        tourId: "t1",
        status: "IN_PROGRESS",
        loadingStartedAt: "2099-07-02T05:40:00.000Z",
        departedAt: "2099-07-02T05:55:00.000Z",
        stops: [],
      },
    ]);
    expect(patched.tour).toMatchObject({
      loadingStartedAt: "2099-07-02T05:40:00.000Z",
      departedAt: "2099-07-02T05:55:00.000Z",
    });
    // An answer without the fields (older server) leaves the stored times alone.
    const untouched = patchTourStates(
      { tour: { id: "t1", status: "RELEASED", departedAt: "x", stops: [] } },
      [{ tourId: "t1", status: "RELEASED", stops: [] }],
    );
    expect(untouched.tour).toMatchObject({ departedAt: "x" });
  });
});
