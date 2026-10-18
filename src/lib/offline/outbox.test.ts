import { describe, expect, it } from "vitest";

import {
  afterFailure,
  BACKOFF_MAX_MS,
  backoffDelayMs,
  chunk,
  mayAttempt,
  nextSeq,
  NO_BACKOFF,
  type OutboxEntry,
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
